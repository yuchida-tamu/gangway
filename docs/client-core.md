[Docs](README.md) › Client core API

# Client core API — `@gangway/client/core`

The client core is the router- and React-free heart of the client: **HTTP transport, the
page-object store, and the visit state machine**. It has no React or React Native imports
by design — it runs (and is unit- and e2e-tested) in plain Node via the
`@gangway/client/core` subpath export.

You normally interact with the core indirectly through the [React bindings](react.md);
reach for it directly when booting the app (constructing the client instance), writing a
[custom router adapter](navigation.md#writing-a-custom-adapter), or testing.

```ts
import { GangwayClient, COMPONENT_UPDATE_REQUIRED } from '@gangway/client/core'
```

## `new GangwayClient(config)`

Create exactly **one** instance per app and hand it to
[`<GangwayProvider>`](react.md#gangwayprovider).

```ts
interface GangwayClientConfig {
  baseUrl: string
  bundleVersion: string
  runtimeVersion: string
  router: RouterAdapter
  onVersionDrift?: (serverVersion: string) => void
  onUpdateRequired?: (info: UpdateRequired) => void
  fetch?: typeof fetch
}
```

| Field | Meaning |
|---|---|
| `baseUrl` | BFF origin; visit URLs are appended to it. |
| `bundleVersion` | This JS bundle's capability version — sent as `X-Gangway-Bundle` on every request. Bump it when you add screens, then ship an OTA update. |
| `runtimeVersion` | The binary's Expo `runtimeVersion` — sent as `X-Gangway-Runtime`. |
| `router` | The [navigation adapter](navigation.md); use `createExpoRouterAdapter()` or your own. |
| `onVersionDrift` | Fired when a page object's `version` ≠ `bundleVersion`. Wire `Updates.checkForUpdateAsync()` here for background self-healing. Not an error — the page still renders. |
| `onUpdateRequired` | Fired on a 409 update gate. Wire `Updates.fetchUpdateAsync()` + `reloadAsync()` here. |
| `fetch` | Custom fetch — the injection point for auth headers, and for tests. |

## Visits

### `visit(url, opts?)`

The heart of the protocol: fetch a page object and hand it to the router.

```ts
interface VisitOptions {
  intent?: NavAction                                      // how to place the screen
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'    // default GET
  data?: Record<string, unknown>                          // JSON body for mutations
}
```

What a successful visit does, in order:

1. Requests `baseUrl + url` with the three Gangway headers (and a JSON body if `data`).
   303 redirects are followed transparently by fetch, so a form POST resolves to the
   *next* screen's page object in the same call.
2. Fires `onVersionDrift` if the page's `version` differs from `bundleVersion`.
3. Mints a fresh session-tagged key and stores the page under it.
4. Asks the router adapter to apply a nav action for that key, carrying the page's
   canonical (post-redirect) `url` so the route can later
   [rehydrate](navigation.md#rehydration). Action resolution: server `page.nav` →
   `opts.intent` → default (`push` for GET, `replace` for mutations — so back never
   reopens a submitted form).

The result is a discriminated union — no exceptions for protocol-level outcomes:

```ts
type VisitResult =
  | { ok: true; page: PageObject; key: string }
  | { ok: false; kind: 'validation'; errors: Errors }          // 422 — no navigation
  | { ok: false; kind: 'update-required'; info: UpdateRequired } // 409 — see below
  | { ok: false; kind: 'error'; status: number; message: string } // network (status 0) or HTTP error
```

On a 409, `visit` also *navigates*: it synthesizes a page whose component is the reserved
name `COMPONENT_UPDATE_REQUIRED` (`'@gangway/update-required'`) and pushes it, so the
update wall is a normal screen rather than a dead tap. `onUpdateRequired` fires first.

### `reload(key)`

Re-fetch the page currently stored under `key` (using its own `url`) and swap it in place —
**no navigation**. This is pull-to-refresh. Exposed to screens as
[`usePage().reload`](react.md#usepage).

### `rehydrate(key, url)`

Repopulate the store entry for an **already-mounted route** by GETting `url` — again, no
navigation. This is the store-loss recovery path: after a JS reload, an OTA
`reloadAsync()`, or a cold start where the OS restored navigation, native routes come back
but the in-memory store is empty. `GangwayScreen` calls this automatically when it finds a
route with no page; see [Navigation § Rehydration](navigation.md#rehydration).

Semantics: no-op if the page is already present; idempotent per key while a fetch is in
flight; a 409 during rehydrate stores the update-required fallback **under the same key**
so a gated screen degrades in place.

### `action<T>(url, data?)`

The escape hatch from the page-object model: POST to a route and get **raw JSON** back —
no navigation, no page store, no router. For in-place widgets (reactions, toggles,
counters). The server side is [`gangway.data()`](server.md#datac-payload).

```ts
type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string }
```

Note the trade-off: action results live in *component* state, not the page store, so a
re-render after store loss shows the page object's (possibly older) props until the screen
refetches. Prefer visits + `reload` when the data belongs to the page.

## The page store

An in-memory `Map<key, PageObject>` with per-key subscriptions — the store behind
`useSyncExternalStore` in the bindings:

- `getPage(key)` — current page object for a key, or `undefined`.
- `setPage(key, page)` — write + notify that key's subscribers. (Public mostly for tests
  and adapters; app code shouldn't need it.)
- `subscribe(key, listener)` — listen for changes to one key; returns an unsubscribe
  function.

**Key semantics.** Keys are minted per successful visit (`g<sessionTag>_<seq>`), the native
stack holds keys, and page objects live here. Back-navigation therefore renders from cache
with zero requests. The session tag prevents keys minted after a JS reload from colliding
with keys embedded in routes the OS restored from the previous session.

**Lifetime.** The store grows with the session — nothing evicts yet
([issue #8](https://github.com/yuchida-tamu/gangway/issues/8)) — and it is per-identity-less:
clear-on-logout is an open design question
([issue #7](https://github.com/yuchida-tamu/gangway/issues/7)).

## `RouterAdapter`

The one interface the core needs from the navigation world:

```ts
interface RouterAdapter {
  apply(action: NavAction, key: string, url: string): void
}
```

`apply` places the screen identified by `key` into native navigation; `url` is the page's
canonical BFF URL, carried in the route for rehydration. See
[Navigation](navigation.md) for the Expo Router implementation and how to write your own.

## Known limitations

Visits currently have **no cancellation, dedup, or timeout** — overlapping visits navigate
in completion order and a double-tap can push twice
([issue #4](https://github.com/yuchida-tamu/gangway/issues/4)). Network failures surface as
`{kind: 'error', status: 0}`; presenting them is the host app's job for now
([issue #5](https://github.com/yuchida-tamu/gangway/issues/5)).

---

Next: [React bindings](react.md)
