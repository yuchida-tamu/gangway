/**
 * @gangway/server — BFF-side half of the Gangway protocol, as a Hono adapter.
 *
 * Usage (see apps/server for a full demo):
 *
 *   type Pages = { 'Orders/Show': { order: Order } }
 *   const g = createGangway<Pages>({ version: '1' })
 *   app.get('/orders/:id', (c) => g.page(c, 'Orders/Show', { order }))
 */
import type { Context } from 'hono'
import {
  HEADER_BUNDLE,
  HEADER_GANGWAY,
  HEADER_RUNTIME,
  HEADER_UPDATE_REQUIRED,
  PROTOCOL_VERSION,
  type ErrorBag,
  type Errors,
  type NavIntent,
  type PageObject,
} from '@gangway/protocol'

export interface GangwayConfig {
  /**
   * The server's current client-bundle version. Included in every page
   * object; the client compares it to its own and self-updates on drift.
   */
  version: string
  /**
   * When a plain browser (no X-Gangway header) hits a route, render the page
   * object as an inspectable HTML <pre> instead of raw JSON. Debug aid only.
   */
  debugHtml?: boolean
}

export interface ClientInfo {
  isGangway: boolean
  /** Expo runtimeVersion of the binary, or null for non-Gangway requests. */
  runtime: string | null
  /** Capability version of the JS bundle / screen registry. */
  bundle: string | null
}

export interface PageOptions {
  /** Override the client's navigation intent (e.g. resetTo after login). */
  nav?: NavIntent
  /** Attach errors to the page (rare — prefer `errors()` for 422s). */
  errors?: Errors
}

export function createGangway<Pages extends Record<string, object>>(config: GangwayConfig) {
  const client = (c: Context): ClientInfo => ({
    isGangway: c.req.header(HEADER_GANGWAY) === PROTOCOL_VERSION,
    runtime: c.req.header(HEADER_RUNTIME) ?? null,
    bundle: c.req.header(HEADER_BUNDLE) ?? null,
  })

  /** Respond with a page object (200). The core primitive. */
  const page = <K extends keyof Pages & string>(
    c: Context,
    component: K,
    props: Pages[K],
    opts: PageOptions = {},
  ): Response => {
    const body: PageObject = {
      component,
      props: { ...props, errors: opts.errors ?? {} },
      url: new URL(c.req.url).pathname + new URL(c.req.url).search,
      version: config.version,
      ...(opts.nav ? { nav: opts.nav } : {}),
    }
    c.header(HEADER_GANGWAY, PROTOCOL_VERSION)
    c.header('Vary', HEADER_GANGWAY)
    if (!client(c).isGangway && config.debugHtml) {
      return c.html(debugPage(body))
    }
    return c.json(body)
  }

  /**
   * Redirect to another Gangway route (303 → client re-requests as GET).
   * Use after successful mutations so the next screen arrives in the same
   * round-trip from the client's point of view.
   */
  const redirect = (c: Context, to: string, opts: { nav?: NavIntent } = {}): Response => {
    c.header(HEADER_GANGWAY, PROTOCOL_VERSION)
    if (opts.nav) c.header('X-Gangway-Nav', opts.nav.action)
    return c.redirect(to, 303)
  }

  /**
   * Validation failure (422). Client stays on its current screen and merges
   * these errors into props.errors.
   */
  const errors = (c: Context, errs: Errors): Response => {
    c.header(HEADER_GANGWAY, PROTOCOL_VERSION)
    const body: ErrorBag = { errors: errs }
    return c.json(body, 422)
  }

  /**
   * Refuse to serve a route to a client whose bundle predates it (409).
   * The client renders its fallback screen and triggers an OTA fetch.
   */
  const updateRequired = (c: Context, opts: { minBundle: string; message?: string }): Response => {
    c.header(HEADER_GANGWAY, PROTOCOL_VERSION)
    c.header(HEADER_UPDATE_REQUIRED, opts.minBundle)
    return c.json({ updateRequired: true as const, minBundle: opts.minBundle, message: opts.message }, 409)
  }

  /**
   * Guard helper: 409 unless the client's bundle version >= min.
   * Versions compare numerically when possible, else lexicographically.
   */
  const requireBundle = (c: Context, min: string): Response | null => {
    const b = client(c).bundle
    if (b !== null && compareVersions(b, min) >= 0) return null
    return updateRequired(c, { minBundle: min })
  }

  return { page, redirect, errors, updateRequired, requireBundle, client, config }
}

function compareVersions(a: string, b: string): number {
  const na = Number(a)
  const nb = Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return a.localeCompare(b)
}

function debugPage(body: PageObject): string {
  return `<!doctype html><html><head><title>gangway: ${escapeHtml(body.component)}</title></head>
<body style="font-family: ui-monospace, monospace; background:#111; color:#9fef00; padding:2rem">
<h3 style="color:#fff">Gangway page object — ${escapeHtml(body.component)}</h3>
<pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>
</body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
