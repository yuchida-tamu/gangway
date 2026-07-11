[Docs](README.md) › Server API

# Server API — `@gangway/server`

`@gangway/server` is the BFF half of the protocol, packaged as a [Hono](https://hono.dev)
adapter. It is in charge of **building protocol-correct responses** — page objects,
redirects, validation errors, update gates — and reading the client's identity headers.
It contains no routing and no domain logic; your Hono app owns routes, your domain layer
owns data.

Peer dependency: `hono >= 4`.

```ts
import { createGangway } from '@gangway/server'

const gangway = createGangway<Pages>({ version: '1', debugHtml: true })
```

## The `Pages` type parameter

`createGangway<Pages>` takes your **page map** — screen name → props shape:

```ts
export type Pages = {
  Home: { greeting: string }
  'Orders/Show': { order: Order }
}
```

This makes `gangway.page()` fully typed: the component name must be a key of `Pages`, and
the props must match its shape — a mismatch is a compile error at the controller. Export
the type so the Expo app can import it **type-only** and derive per-screen prop types
(see [Getting started §2.1](getting-started.md#21-one-client-instance)).

`Pages` is a TypeScript convenience, not part of the wire protocol. A non-TS server just
returns the same JSON shapes.

## `GangwayConfig`

| Field | Type | Meaning |
|---|---|---|
| `version` | `string` | The client-bundle version this server currently expects. Stamped into every page object; clients compare it to their own and self-update on drift. |
| `debugHtml?` | `boolean` | When a plain browser (no `X-Gangway` header) hits a route, render the page object as inspectable HTML instead of raw JSON. Debug aid only. |

## Response helpers

`createGangway` returns an object of helpers. Each takes the Hono `Context` first and
returns a `Response` — use them as the return value of a route handler.

### `page(c, component, props, opts?)`

The core primitive: respond with a [page object](protocol.md#pageobject) (200).

```ts
app.get('/orders/:id', (c) => gangway.page(c, 'Orders/Show', { order }))
```

- `component` must be a key of `Pages`; `props` must match `Pages[component]`.
- `props.errors` is added automatically (empty unless `opts.errors` is given).
- The page's `url` is derived from the request (`pathname + search`), and `version` from
  the config.
- `opts.nav` sets a server [navigation override](navigation.md#how-the-nav-action-is-chosen),
  e.g. present a form as a native modal:

```ts
app.get('/orders/new', (c) =>
  gangway.page(c, 'Orders/New', { defaults }, { nav: { action: 'modal' } }))
```

- `opts.errors` attaches validation errors to a page — rare; prefer `errors()` for 422s.

### `redirect(c, to, opts?)`

Redirect to another Gangway route with `303 See Other`. Use after every successful
mutation: fetch follows the redirect transparently, so from the client's point of view the
POST *resolves to the next screen's page object* in one round-trip.

```ts
app.post('/orders', async (c) => {
  const order = await create(c)
  return gangway.redirect(c, `/orders/${order.id}`)
})
```

> **Caveat:** `opts.nav` on a redirect currently has **no effect on the client** — RN fetch
> follows 303s transparently, so intermediate response headers are unreadable
> ([protocol deviation 2](protocol.md#deviation-2-no-nav-overrides-on-redirects)). Put nav
> overrides on the *target* page instead.

### `errors(c, errs)`

Validation failure (422). The client stays on its current screen; the errors surface in
[`useForm().errors`](react.md#useform).

```ts
if (!body.title?.trim()) return gangway.errors(c, { title: 'Title is required.' })
```

Keys are field names; use `_` by convention for form-level errors.

### `data(c, payload)`

Respond to an in-place [**action**](react.md#useaction) with raw JSON — **not** a page
object and **not** a redirect. The client's `action()` returns this payload for the
component to merge into local widget state; nothing navigates and the page store is
untouched.

```ts
app.post('/orders/:id/react', (c) => {
  order.reactions += 1
  return gangway.data(c, { reactions: order.reactions })
})
```

Use for like/react buttons, toggles, counters — server state that changes *within* a
screen. If the interaction should move the user somewhere, it's a mutation: use
`redirect()` instead.

### `updateRequired(c, opts)`

Refuse to serve the route to a stale client: responds `409` with an
[`UpdateRequired`](protocol.md#updaterequired-409) body and the
`X-Gangway-Update-Required` header. `opts` is `{ minBundle: string; message?: string }`.
You'll rarely call this directly — use `requireBundle`.

### `requireBundle(c, min)`

Guard helper for gating a route on a minimum client bundle version. Returns `null` when
the client passes, or a ready-made 409 `Response` when it doesn't — hence the early-return
pattern:

```ts
app.get('/vip', (c) => {
  const gate = gangway.requireBundle(c, '2')
  if (gate) return gate
  return gangway.page(c, 'Vip', { message: 'Welcome.' })
})
```

Versions compare numerically when both parse as numbers, else lexicographically — so
**use plain integer bundle versions** (`'1'`, `'2'`, …); dotted versions like `'1.10'`
would mis-order under the lexicographic fallback
([issue #9](https://github.com/yuchida-tamu/gangway/issues/9)).

### `client(c)`

Read the caller's identity headers:

```ts
interface ClientInfo {
  isGangway: boolean       // X-Gangway header matches the protocol version
  runtime: string | null   // Expo runtimeVersion of the binary
  bundle: string | null    // JS bundle / registry capability version
}
```

Use it to branch per runtime (`if (client(c).runtime === 'exposdk:53') …`) or to serve
non-Gangway callers differently. `config` (the `GangwayConfig` you passed) is also exposed
on the returned object.

## When to use which helper

| Situation | Helper |
|---|---|
| GET route → screen | `page` |
| Mutation succeeded | `redirect` (303 to the resulting resource) |
| Mutation failed validation | `errors` (422, user stays put) |
| In-place widget update, no navigation | `data` |
| Route needs a newer bundle | `requireBundle` guard at the top |
| Branch on client version | `client(c).runtime` / `.bundle` |

---

Next: [Client core API](client-core.md)
