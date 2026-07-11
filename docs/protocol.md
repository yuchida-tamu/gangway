[Docs](README.md) › Wire protocol

# Wire protocol — `@gangway/protocol`

`@gangway/protocol` is the single contract between the BFF and the native client. It
contains **transport shapes only** — TypeScript types, header-name constants, and two type
guards. No runtime logic, no dependencies. Both `@gangway/server` and `@gangway/client`
depend on it; nothing else should need to import it directly except when typing shared
helpers.

The protocol is modeled on [Inertia's](https://inertiajs.com/the-protocol), with one
addition (navigation intents) and two deviations (noted below). It is language-agnostic —
a BFF in any language can implement it by honoring these shapes.

## Request headers

Every Gangway request carries three headers (constants exported by the package):

| Constant | Header | Value |
|---|---|---|
| `HEADER_GANGWAY` | `X-Gangway` | Protocol version — `PROTOCOL_VERSION`, currently `'1'` |
| `HEADER_RUNTIME` | `X-Gangway-Runtime` | Expo `runtimeVersion` of the binary (the native contract) |
| `HEADER_BUNDLE` | `X-Gangway-Bundle` | Capability version of the JS bundle / screen registry |

Visits use `GET`; mutations use `POST`/`PUT`/`PATCH`/`DELETE` with a JSON body.

The one response header constant is `HEADER_UPDATE_REQUIRED` (`X-Gangway-Update-Required`),
set on 409 responses with the minimum bundle version.

## Response shapes by status

| Status | Body | Meaning | Client behavior |
|---|---|---|---|
| `200` | `PageObject` | A screen to render | Store it, apply a nav action |
| `303` | — | Successful mutation, see other | fetch follows transparently; the client only ever sees the target's 200 |
| `422` | `ErrorBag` | Validation failure | Stay put; surface `errors` to the form |
| `409` | `UpdateRequired` | Client bundle too old for this route | Show the update fallback, trigger OTA |
| other non-2xx | anything | Transport/server error | Surfaced as a `kind: 'error'` visit result |

## `PageObject`

The unit of every successful response:

```jsonc
{
  "component": "Orders/Show",                  // resolved via the client registry
  "props": { "order": { ... }, "errors": {} }, // errors is ALWAYS present (possibly empty)
  "url": "/orders/42",                         // canonical URL of this page on the BFF
  "version": "1",                              // bundle version the server currently expects
  "nav": { "action": "modal" }                 // optional server nav override
}
```

```ts
interface PageObject<P = Record<string, unknown>> {
  component: string
  props: P & { errors: Errors }
  url: string
  version: string
  nav?: NavIntent
}
```

Field notes:

- **`props.errors`** — `Errors` is `Record<string, string>`, keyed by field name (use `_`
  for form-level errors). Always present so screens can destructure it unconditionally.
- **`url`** — the *canonical* URL, i.e. the post-redirect URL after a 303. The client
  carries it in the native route so a screen can re-fetch itself if the in-memory store is
  lost ([rehydration](navigation.md#rehydration)).
- **`version`** — compared against the client's own bundle version; a mismatch fires the
  client's `onVersionDrift` hook. Drift is **not an error**; the page still renders. See
  [Versioning](versioning.md).
- **`nav`** — optional server override of how the screen is placed into navigation. See
  [Navigation](navigation.md#how-the-nav-action-is-chosen).

## `NavAction` / `NavIntent`

```ts
type NavAction = 'push' | 'replace' | 'resetTo' | 'back' | 'modal'
interface NavIntent { action: NavAction }
```

An abstract instruction, deliberately navigator-agnostic. The
[router adapter](navigation.md) decides what each action means concretely.

## `ErrorBag` (422)

```ts
interface ErrorBag { errors: Errors }   // Errors = Record<string, string>
```

**Deviation from web Inertia:** Inertia redirects back with errors in session flash;
Gangway returns the errors directly on the 422. Mobile clients are assumed token-authed
and sessionless, and skipping the redirect saves a round-trip.

## `UpdateRequired` (409)

```ts
interface UpdateRequired {
  updateRequired: true
  minBundle: string
  message?: string
}
```

Sent when the server refuses to serve a route to a stale bundle
([`requireBundle`](server.md#requirebundlec-min)). The client synthesizes a fallback page and
triggers an OTA fetch — the full flow is described in [Versioning](versioning.md).

## Type guards

```ts
isPageObject(x): x is PageObject       // structural check on component/url/props
isUpdateRequired(x): x is UpdateRequired
```

Used by the client core to validate response bodies before trusting them; useful in tests.

## Deviation 2: no nav overrides on redirects

React Native's fetch follows 303s transparently and offers no reliable
`redirect: 'manual'`, so headers on the *intermediate* redirect response are unreadable by
the client. Nav overrides therefore live **on page objects only** — the redirect *target*
declares its own presentation. Keep this constraint in mind when designing protocol
features: anything the client must see has to survive to the final 200.

## Extending the protocol

A protocol change touches **three places in lockstep**: this package, the
[server helpers](server.md), and the [client core](client-core.md) — plus DESIGN.md §4 and
the e2e suite (`apps/server/test/e2e.ts`). If a change doesn't need all three, question
whether it's really a protocol change.

---

Next: [Server API](server.md)
