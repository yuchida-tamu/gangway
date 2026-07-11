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
  fetch?: typeof fetch
}

export interface VisitOptions {
  intent?: NavAction
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  data?: Record<string, unknown>
}

export type VisitResult =
  | { ok: true; page: PageObject; key: string }
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
   * The heart of the protocol. Fetch a page object from the BFF and hand it
   * to the router adapter. 303 redirects are followed transparently by fetch,
   * so a form POST resolves to the *next* screen's page object in one call.
   */
  async visit(url: string, opts: VisitOptions = {}): Promise<VisitResult> {
    const method = opts.method ?? 'GET'
    const res = await this.request(url, method, opts.data)
    if ('networkError' in res) return { ok: false, kind: 'error', status: 0, message: res.networkError }
    const parsed = await this.parse(res)

    if (parsed.kind === 'validation') return { ok: false, kind: 'validation', errors: parsed.errors }
    if (parsed.kind === 'error') return { ok: false, kind: 'error', status: parsed.status, message: parsed.message }

    if (parsed.kind === 'update-required') {
      this.config.onUpdateRequired?.(parsed.info)
      // Navigate to a synthetic page so the fallback screen shows in place.
      const key = this.nextKey()
      this.setPage(key, this.updateRequiredPage(parsed.info, url))
      this.config.router.apply(opts.intent ?? 'push', key, url)
      return { ok: false, kind: 'update-required', info: parsed.info }
    }

    const { page } = parsed
    if (page.version !== this.config.bundleVersion) this.config.onVersionDrift?.(page.version)
    const key = this.nextKey()
    this.setPage(key, page)
    // Server nav override wins; otherwise the intent the visit started with.
    // Mutations default to `replace` so back doesn't reopen a submitted form.
    const fallbackIntent: NavAction = method === 'GET' ? 'push' : 'replace'
    const action = page.nav?.action ?? opts.intent ?? fallbackIntent
    // Carry the page's canonical URL (post-redirect) so the route can rehydrate.
    this.config.router.apply(action, key, page.url)
    return { ok: true, page, key }
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
