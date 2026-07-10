/**
 * The Gangway wire protocol — the single contract between the BFF and the
 * native client. Everything here is transport-shape only; no runtime code.
 *
 * See DESIGN.md §4 for the full protocol spec.
 */

/** Request headers (client → server). */
export const HEADER_GANGWAY = 'X-Gangway'
/** Expo runtimeVersion baked into the binary (native contract). */
export const HEADER_RUNTIME = 'X-Gangway-Runtime'
/** Client capability version: identifies the JS bundle / screen registry. */
export const HEADER_BUNDLE = 'X-Gangway-Bundle'

/** Response headers (server → client). */
export const HEADER_UPDATE_REQUIRED = 'X-Gangway-Update-Required'

export const PROTOCOL_VERSION = '1'

/**
 * How the client should place the resolved screen into native navigation.
 * Absent in a response = keep the intent the client initiated the visit with.
 */
export type NavAction = 'push' | 'replace' | 'resetTo' | 'back' | 'modal'

export interface NavIntent {
  action: NavAction
}

/** Validation / domain errors, keyed by field (or `_` for form-level). */
export type Errors = Record<string, string>

/**
 * The page object — the unit of every successful Gangway response.
 * Mirrors Inertia's `{component, props, url, version}` plus a native
 * navigation intent.
 */
export interface PageObject<P = Record<string, unknown>> {
  /** Screen name the client resolves via its registry, e.g. "Orders/Show". */
  component: string
  /** Props for that screen. `errors` is always present (possibly empty). */
  props: P & { errors: Errors }
  /** Canonical URL of this page on the BFF. */
  url: string
  /** Server's current bundle version; client compares against its own. */
  version: string
  /** Optional server override of the client's navigation intent. */
  nav?: NavIntent
}

/**
 * 422 body on validation failure. The client stays on the current screen
 * and merges `errors` into its props (deviation from web Inertia's
 * session-flash redirect — see DESIGN.md §4.4).
 */
export interface ErrorBag {
  errors: Errors
}

/**
 * 409 body when the server refuses to serve a route to a stale client.
 * `minBundle` tells the client what capability version it needs; the client
 * shows its fallback screen and triggers an expo-updates fetch.
 */
export interface UpdateRequired {
  updateRequired: true
  minBundle: string
  message?: string
}

export function isPageObject(x: unknown): x is PageObject {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as PageObject).component === 'string' &&
    typeof (x as PageObject).url === 'string' &&
    typeof (x as PageObject).props === 'object'
  )
}

export function isUpdateRequired(x: unknown): x is UpdateRequired {
  return typeof x === 'object' && x !== null && (x as UpdateRequired).updateRequired === true
}
