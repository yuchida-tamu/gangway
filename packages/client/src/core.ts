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
   * The screen resolves its page object from the store via that key.
   */
  apply(action: NavAction, key: string): void
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

type Listener = () => void

export class GangwayClient {
  private pages = new Map<string, PageObject>()
  private listeners = new Map<string, Set<Listener>>()
  private seq = 0

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
    const doFetch = this.config.fetch ?? fetch
    let res: Response
    try {
      res = await doFetch(this.config.baseUrl + url, {
        method,
        headers: {
          [HEADER_GANGWAY]: PROTOCOL_VERSION,
          [HEADER_BUNDLE]: this.config.bundleVersion,
          [HEADER_RUNTIME]: this.config.runtimeVersion,
          ...(opts.data ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(opts.data ? { body: JSON.stringify(opts.data) } : {}),
      })
    } catch (e) {
      return { ok: false, kind: 'error', status: 0, message: String(e) }
    }

    if (res.status === 422) {
      const body = (await res.json()) as { errors?: Errors }
      return { ok: false, kind: 'validation', errors: body.errors ?? {} }
    }

    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as unknown
      const info: UpdateRequired = isUpdateRequired(body)
        ? body
        : { updateRequired: true, minBundle: 'unknown' }
      this.config.onUpdateRequired?.(info)
      // Navigate to a synthetic page so the fallback screen shows in place.
      const key = this.nextKey()
      this.setPage(key, {
        component: COMPONENT_UPDATE_REQUIRED,
        props: { errors: {}, info },
        url,
        version: this.config.bundleVersion,
      })
      this.config.router.apply(opts.intent ?? 'push', key)
      return { ok: false, kind: 'update-required', info }
    }

    if (!res.ok) {
      return { ok: false, kind: 'error', status: res.status, message: await res.text() }
    }

    const body = (await res.json()) as unknown
    if (!isPageObject(body)) {
      return { ok: false, kind: 'error', status: res.status, message: 'Response is not a Gangway page object' }
    }

    if (body.version !== this.config.bundleVersion) {
      this.config.onVersionDrift?.(body.version)
    }

    const key = this.nextKey()
    this.setPage(key, body)
    // Server nav override wins; otherwise the intent the visit started with.
    // Mutations default to `replace` so back doesn't reopen a submitted form.
    const fallbackIntent: NavAction = method === 'GET' ? 'push' : 'replace'
    const action = body.nav?.action ?? opts.intent ?? fallbackIntent
    this.config.router.apply(action, key)
    return { ok: true, page: body, key }
  }

  /** Refetch a page in place (pull-to-refresh) without touching navigation. */
  async reload(key: string): Promise<VisitResult> {
    const current = this.pages.get(key)
    if (!current) return { ok: false, kind: 'error', status: 0, message: `No page for key ${key}` }
    const doFetch = this.config.fetch ?? fetch
    const res = await doFetch(this.config.baseUrl + current.url, {
      headers: {
        [HEADER_GANGWAY]: PROTOCOL_VERSION,
        [HEADER_BUNDLE]: this.config.bundleVersion,
        [HEADER_RUNTIME]: this.config.runtimeVersion,
      },
    })
    if (!res.ok) return { ok: false, kind: 'error', status: res.status, message: await res.text() }
    const body = (await res.json()) as unknown
    if (!isPageObject(body)) {
      return { ok: false, kind: 'error', status: res.status, message: 'Response is not a Gangway page object' }
    }
    this.setPage(key, body)
    return { ok: true, page: body, key }
  }

  private nextKey(): string {
    this.seq += 1
    return `g${this.seq}`
  }
}
