/**
 * Router-agnostic client core: transport, page store, visit lifecycle.
 * No React / React Native imports — this file runs (and is e2e-tested)
 * in plain Node. The Expo Router glue lives in expoRouterAdapter.ts.
 */
import {
  HEADER_BUNDLE,
  HEADER_GANGWAY,
  HEADER_RUNTIME,
  PROTOCOL_VERSION,
  isPageObject,
  isUpdateRequired,
  type Errors,
  type NavAction,
  type PageObject,
  type UpdateRequired,
} from '@gangway/protocol'

/** Reserved component names rendered by the fallback screen, not the registry. */
export const COMPONENT_UPDATE_REQUIRED = '@gangway/update-required'

export interface RouterAdapter {
  /**
   * Place the screen identified by `key` into native navigation.
   * The screen resolves its page object from the store via that key; `url`
   * is the page's canonical BFF URL, carried in the route so the screen can
   * re-fetch (rehydrate) if the in-memory store is later lost (§ rehydrate).
   */
  apply(action: NavAction, key: string, url: string): void
}

export interface GangwayClientConfig {
  baseUrl: string
  /** Capability version of this JS bundle (sent as X-Gangway-Bundle). */
  bundleVersion: string
  /** Expo runtimeVersion of the binary (sent as X-Gangway-Runtime). */
  runtimeVersion: string
  router: RouterAdapter
  /**
   * Called when a page object's `version` differs from bundleVersion —
   * hook up Updates.checkForUpdateAsync() here for background self-healing.
   */
  onVersionDrift?: (serverVersion: string) => void
  /** Called on 409 / missing screen — hook up an immediate OTA fetch here. */
  onUpdateRequired?: (info: UpdateRequired) => void
  /**
   * Stale-while-revalidate window (ms). A URL-cached page younger than this is
   * served on visit() without a refetch; an older one is served immediately AND
   * revalidated in the background. Default 3000.
   */
  revalidateAfterMs?: number
  /** Max distinct URLs kept in the prefetch/SWR cache (insertion-order evict).
   *  Default 50. */
  maxCachedPages?: number
  fetch?: typeof fetch
}

export interface VisitOptions {
  intent?: NavAction
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: Record<string, unknown>
}

export type VisitResult =
  | { ok: true; page: PageObject; key: string; fromCache?: boolean }
  | { ok: false; kind: 'validation'; errors: Errors }
  | { ok: false; kind: 'update-required'; info: UpdateRequired }
  | { ok: false; kind: 'error'; status: number; message: string }

/** Result of an in-place action() — raw server data, no page/navigation. */
export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }

type Listener = () => void

type ParseResult =
  | { kind: 'page'; page: PageObject }
  | { kind: 'update-required'; info: UpdateRequired }
  | { kind: 'validation'; errors: Errors }
  | { kind: 'error'; status: number; message: string }

export class GangwayClient {
  private pages = new Map<string, PageObject>()
  private listeners = new Map<string, Set<Listener>>()
  private seq = 0
  /** Per-session prefix so keys minted after a JS reload can't collide with
   *  keys embedded in routes that Expo Router restored from the old session. */
  private readonly tag = mintTag()
  /** Keys with a rehydrate() fetch in flight — makes rehydrate idempotent. */
  private inflight = new Set<string>()
  /** URL-indexed prefetch/SWR cache (separate from the key store; additive —
   *  never touched by back-nav or rehydrate). Insertion-ordered for eviction. */
  private urlCache = new Map<string, { page: PageObject; at: number }>()
  /** In-flight GETs keyed by URL, so a press-in prefetch and the following
   *  visit (or a concurrent revalidate) coalesce into one network request. */
  private pending = new Map<string, Promise<ParseResult | { networkError: string }>>()

  constructor(private config: GangwayClientConfig) {}

  /** ---- page store (consumed by useSyncExternalStore in react.tsx) ---- */

  getPage(key: string): PageObject | undefined {
    return this.pages.get(key)
  }

  setPage(key: string, page: PageObject): void {
    this.pages.set(key, page)
    this.listeners.get(key)?.forEach((l) => l())
  }

  subscribe(key: string, listener: Listener): () => void {
    const set = this.listeners.get(key) ?? new Set<Listener>()
    this.listeners.set(key, set)
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  /** ---- visits ---- */

  /**
   * The heart of the protocol. Resolve a URL to a page object and hand it to
   * the router adapter. Three paths:
   *  - GET + a URL-cache hit (WARM): navigate SYNCHRONOUSLY this frame, then
   *    stale-while-revalidate in the background;
   *  - GET + cold/in-flight: reuse any press-in prefetch, then navigate;
   *  - mutation: request/parse/commit as usual, then invalidate the URL cache.
   * 303 redirects are followed transparently by fetch, so a form POST resolves
   * to the *next* screen's page object in one call.
   */
  async visit(url: string, opts: VisitOptions = {}): Promise<VisitResult> {
    const method = opts.method ?? 'GET'

    if (method === 'GET') {
      const hit = this.urlCache.get(url)
      if (hit) {
        // WARM. commitPage runs BEFORE any await, so router.apply fires in the
        // same synchronous turn as the tap = the push starts this frame.
        const committed = this.commitPage(hit.page, opts.intent, method)
        if (Date.now() - hit.at >= this.revalidateAfterMs()) {
          void this.revalidate(committed.key, url) // stale → refresh in background
        }
        return { ...committed, fromCache: true }
      }
      // COLD / in-flight: fetchDedup reuses a pending prefetch (the head-start).
      const parsed = await this.fetchDedup(url)
      if ('networkError' in parsed) return { ok: false, kind: 'error', status: 0, message: parsed.networkError }
      const committed = this.commitParsed(parsed, url, opts.intent, method)
      if (committed.ok) this.cacheSet(url, committed.page)
      return committed
    }

    // MUTATION (non-GET): as before, then drop speculative caches — a write may
    // have changed anything (blunt but never serves wrong data; see issue #2).
    const res = await this.request(url, method, opts.data)
    if ('networkError' in res) return { ok: false, kind: 'error', status: 0, message: res.networkError }
    const parsed = await this.parse(res)
    const committed = this.commitParsed(parsed, url, opts.intent, method)
    this.urlCache.clear()
    return committed
  }

  /**
   * Speculatively fetch and cache a URL's page (call on Link press-in). Silent
   * and side-effect-free: it never navigates and never fires onUpdateRequired —
   * a 409/422/error/network failure is swallowed so a stray press-in can't
   * surprise the user with an update prompt. Coalesces with the following visit.
   */
  async prefetch(url: string): Promise<void> {
    const hit = this.urlCache.get(url)
    if (hit && Date.now() - hit.at < this.revalidateAfterMs()) return // already fresh
    const parsed = await this.fetchDedup(url)
    if ('networkError' in parsed) return
    if (parsed.kind === 'page') this.cacheSet(url, parsed.page)
  }

  /** Refetch a page in place (pull-to-refresh) without touching navigation. */
  async reload(key: string): Promise<VisitResult> {
    const current = this.pages.get(key)
    if (!current) return { ok: false, kind: 'error', status: 0, message: `No page for key ${key}` }
    return this.load(key, current.url)
  }

  /**
   * Repopulate the page for an already-mounted route `key` by re-fetching its
   * `url`, WITHOUT navigating. Called by a screen whose store entry is gone —
   * after a JS reload / OTA reloadAsync(), or a cold start where the OS
   * restored navigation but not the in-memory store. Idempotent per key while
   * a fetch is in flight, and a no-op if the page is already present.
   */
  async rehydrate(key: string, url: string): Promise<VisitResult> {
    const existing = this.pages.get(key)
    if (existing) return { ok: true, page: existing, key }
    if (this.inflight.has(key)) {
      return { ok: false, kind: 'error', status: 0, message: 'rehydrate already in flight' }
    }
    this.inflight.add(key)
    try {
      return await this.load(key, url)
    } finally {
      this.inflight.delete(key)
    }
  }

  /**
   * Call a server route for a side-effect and fresh data, WITHOUT navigating,
   * storing a page, or touching the router. Returns the server's raw JSON
   * body. This is the escape hatch from the page-object model, for in-place
   * widgets — like/react buttons, toggles, counters — that update local
   * component state (and animate) without a navigation. Server responds with
   * `gangway.data(c, payload)`.
   */
  async action<T = unknown>(url: string, data?: Record<string, unknown>): Promise<ActionResult<T>> {
    const res = await this.request(url, 'POST', data ?? {})
    if ('networkError' in res) return { ok: false, status: 0, message: res.networkError }
    if (!res.ok) return { ok: false, status: res.status, message: await res.text() }
    const body = (await res.json().catch(() => null)) as T
    return { ok: true, data: body }
  }

  /** GET `url` and store the resulting page under `key`, without navigating.
   *  Shared by reload() and rehydrate(). */
  private async load(key: string, url: string): Promise<VisitResult> {
    const res = await this.request(url)
    if ('networkError' in res) return { ok: false, kind: 'error', status: 0, message: res.networkError }
    const parsed = await this.parse(res)
    switch (parsed.kind) {
      case 'page':
        if (parsed.page.version !== this.config.bundleVersion) this.config.onVersionDrift?.(parsed.page.version)
        this.setPage(key, parsed.page)
        return { ok: true, page: parsed.page, key }
      case 'update-required':
        this.config.onUpdateRequired?.(parsed.info)
        this.setPage(key, this.updateRequiredPage(parsed.info, url))
        return { ok: false, kind: 'update-required', info: parsed.info }
      case 'validation':
        return { ok: false, kind: 'validation', errors: parsed.errors }
      case 'error':
        return { ok: false, kind: 'error', status: parsed.status, message: parsed.message }
    }
  }

  /** ---- prefetch / stale-while-revalidate helpers ---- */

  private revalidateAfterMs(): number {
    return this.config.revalidateAfterMs ?? 3000
  }

  /** One in-flight GET per URL: prefetch, cold visit, and revalidate coalesce. */
  private fetchDedup(url: string): Promise<ParseResult | { networkError: string }> {
    const existing = this.pending.get(url)
    if (existing) return existing
    const p = (async () => {
      const res = await this.request(url)
      if ('networkError' in res) return res
      return this.parse(res)
    })().finally(() => this.pending.delete(url))
    this.pending.set(url, p)
    return p
  }

  /** Cache a page by URL, most-recent last, evicting oldest past the cap. */
  private cacheSet(url: string, page: PageObject): void {
    this.urlCache.delete(url)
    this.urlCache.set(url, { page, at: Date.now() })
    const max = this.config.maxCachedPages ?? 50
    while (this.urlCache.size > max) {
      const oldest = this.urlCache.keys().next().value
      if (oldest === undefined) break
      this.urlCache.delete(oldest)
    }
  }

  /**
   * Store a page under a fresh key and navigate. LOAD-BEARING: this method is
   * synchronous and must run before any `await` on visit()'s warm path, so the
   * native push fires in the same frame as the tap. Do not add awaits here.
   */
  private commitPage(page: PageObject, intent: NavAction | undefined, method: string): { ok: true; page: PageObject; key: string } {
    if (page.version !== this.config.bundleVersion) this.config.onVersionDrift?.(page.version)
    const key = this.nextKey()
    this.setPage(key, page)
    // Server nav override wins; else the visit's intent; else GET→push / else replace.
    const fallbackIntent: NavAction = method === 'GET' ? 'push' : 'replace'
    const action = page.nav?.action ?? intent ?? fallbackIntent
    this.config.router.apply(action, key, page.url)
    return { ok: true, page, key }
  }

  /** Turn a parsed response into a VisitResult, navigating as appropriate.
   *  Preserves the four-kind handling the un-refactored visit() had. */
  private commitParsed(parsed: ParseResult, url: string, intent: NavAction | undefined, method: string): VisitResult {
    switch (parsed.kind) {
      case 'validation':
        return { ok: false, kind: 'validation', errors: parsed.errors }
      case 'error':
        return { ok: false, kind: 'error', status: parsed.status, message: parsed.message }
      case 'update-required': {
        this.config.onUpdateRequired?.(parsed.info)
        const key = this.nextKey()
        this.setPage(key, this.updateRequiredPage(parsed.info, url))
        this.config.router.apply(intent ?? 'push', key, url)
        return { ok: false, kind: 'update-required', info: parsed.info }
      }
      case 'page':
        return this.commitPage(parsed.page, intent, method)
    }
  }

  /** Background refresh of an already-visited key: swap props in place via the
   *  store, no navigation. Silent on error/409/422 (keep the stale page). */
  private async revalidate(key: string, url: string): Promise<void> {
    const parsed = await this.fetchDedup(url)
    if ('networkError' in parsed || parsed.kind !== 'page') return
    this.cacheSet(url, parsed.page)
    this.setPage(key, parsed.page)
  }

  private async request(
    url: string,
    method: VisitOptions['method'] = 'GET',
    data?: Record<string, unknown>,
  ): Promise<Response | { networkError: string }> {
    const doFetch = this.config.fetch ?? fetch
    try {
      return await doFetch(this.config.baseUrl + url, {
        method,
        headers: {
          [HEADER_GANGWAY]: PROTOCOL_VERSION,
          [HEADER_BUNDLE]: this.config.bundleVersion,
          [HEADER_RUNTIME]: this.config.runtimeVersion,
          ...(data ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      })
    } catch (e) {
      return { networkError: String(e) }
    }
  }

  /** Map an HTTP response to protocol data. No side effects (no store, no
   *  navigation, no callbacks) — callers decide what to do with the outcome. */
  private async parse(res: Response): Promise<ParseResult> {
    if (res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { errors?: Errors }
      return { kind: 'validation', errors: body.errors ?? {} }
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as unknown
      const info: UpdateRequired = isUpdateRequired(body) ? body : { updateRequired: true, minBundle: 'unknown' }
      return { kind: 'update-required', info }
    }
    if (!res.ok) {
      return { kind: 'error', status: res.status, message: await res.text() }
    }
    const body = (await res.json()) as unknown
    if (!isPageObject(body)) {
      return { kind: 'error', status: res.status, message: 'Response is not a Gangway page object' }
    }
    return { kind: 'page', page: body }
  }

  private updateRequiredPage(info: UpdateRequired, url: string): PageObject {
    return {
      component: COMPONENT_UPDATE_REQUIRED,
      props: { errors: {}, info },
      url,
      version: this.config.bundleVersion,
    }
  }

  private nextKey(): string {
    this.seq += 1
    return `g${this.tag}_${this.seq}`
  }
}

/** Session-unique key prefix (base36 timestamp). Distinct per JS load, so
 *  post-reload keys never collide with keys baked into restored routes. */
function mintTag(): string {
  return Math.floor(Date.now() % 0xffffff).toString(36)
}
