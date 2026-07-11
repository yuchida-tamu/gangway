[Docs](README.md) › Concepts & architecture

# Concepts & architecture

## The idea in one paragraph

In a classic mobile app the client owns navigation and calls a data API; every flow change
ships through an app release. In Gangway the client asks the server *"the user tapped this —
what now?"* and the server answers with a **page object**: the name of a screen the app
already has, the props to render it with, and (optionally) how to place it in native
navigation. Screens stay ordinary React Native components in the bundle; sequencing, data,
and flow decisions live in BFF controllers you can redeploy any time.

## Layers

```
┌─ Expo app ───────────────────────────────────────────────────┐
│  Screen components   — ordinary RN code, shipped in bundle   │
│  Screen registry     — name → component (capability set)     │
│  Client runtime      — @gangway/client: visits, forms, cache │
│  Navigation adapter  — maps nav intents onto Expo Router     │
└──────────────────── wire protocol ───────────────────────────┘
┌─ BFF (framework home) ───────────────────────────────────────┐
│  Routes/controllers  — resolve each URL to a page object     │
│  Flow control        — redirects, validation errors, gates   │
│  Version negotiation — per-client runtime/bundle awareness   │
└─────────────── ordinary function calls ──────────────────────┘
┌─ Backend domain ─────────────────────────────────────────────┐
│  Models/services/auth — never sees screen names or payloads  │
└──────────────────────────────────────────────────────────────┘
```

The BFF and the domain may be one process. The boundary is conceptual: **only the BFF layer
knows screen names.** The wire protocol is language-agnostic; the reference server is
TypeScript/Hono so the prototype can share types end-to-end.

## The three contracts

Gangway is three small contracts, one per documentation page:

1. **The [wire protocol](protocol.md)** — what a request and a response look like: page
   objects on 200, redirects on 303, validation errors on 422, update gates on 409, plus
   three request headers identifying the client.
2. **The component contract** — the server's `Pages` type (screen name → props shape) and
   the client's **registry** (screen name → component) are two halves of one agreement. In
   a TypeScript monorepo the app imports the `Pages` type *type-only*, so a controller that
   returns props a screen doesn't expect is a compile error. See [Server API](server.md)
   and [React bindings](react.md).
3. **The [navigation mapping](navigation.md)** — how abstract nav intents
   (`push | replace | resetTo | back | modal`) land on a real navigator. Stack/tab
   *structure* stays client-defined; the server only decides *which screen* renders and
   *when to redirect*. Gangway deliberately does not let the server define tab bars — that
   is the slippery slope back to full server-driven UI.

## The life of a visit

Every navigation is a **visit** — the protocol's unit of interaction:

1. The user presses a [`<Link href="/orders">`](react.md#link) (or code calls
   [`useVisit()`](react.md#usevisit)).
2. `GangwayClient.visit('/orders')` GETs the BFF with the Gangway headers.
3. A controller runs and responds with a page object:
   `{component: 'Orders/Index', props: {orders}, url: '/orders', version: '1'}`.
4. The client stores the page object in its in-memory **page store** under a freshly minted
   key, then asks the **router adapter** to apply a nav action for that key
   (server override → client intent → default).
5. The adapter navigates to the catch-all route `/s/<key>`; the
   [`GangwayScreen`](react.md#gangwayscreen) mounted there looks the key up in the store,
   resolves `Orders/Index` in the registry, and renders `<OrdersIndex {...props} />`.

Two consequences worth internalizing:

- **The native stack holds keys, not data.** Going *back* pops to a previous key whose page
  object is still cached — back-nav makes **zero network requests**, matching native
  expectations. (Corollary: cached pages can go stale after mutations —
  [issue #2](https://github.com/yuchida-tamu/gangway/issues/2).)
- **Forms don't need client-side result handling.** A `POST` that succeeds answers with a
  `303 See Other`; fetch follows it transparently, so the client receives the *next
  screen's* page object in the same round-trip. A `422` keeps the user in place with field
  errors. See [`useForm`](react.md#useform).

There is exactly one escape hatch from the page-object model:
[**actions**](react.md#useaction) — a POST that returns raw JSON for in-place widgets
(reactions, toggles) with no navigation and no page-store change.

## The two walls (and why the failure surface is small)

Any server-driven approach hits two walls; Gangway names them and owns them:

- **Wall 1 — native changes need a store release.** Accepted. Expo's `runtimeVersion` names
  the JS↔native contract, and clients report it on every request so the BFF can branch or
  degrade per runtime.
- **Wall 2 — the server names a screen the client doesn't have.** Because the server only
  ever sends a *screen name* (never a UI tree), the entire failure surface is **one
  registry lookup** with one well-defined fallback screen, plus an OTA-update recovery
  path. See [Versioning & updates](versioning.md).

## What development feels like

- **Data or flow change** (the common case): edit a controller, deploy the BFF. Every
  installed client gets the new behavior on its next visit. No release.
- **New screen:** add a controller + an RN component + a registry entry, bump the client
  bundle version, ship an EAS update. The server can return the new screen immediately —
  stale clients see the fallback until their OTA lands.
- **Flow experiment:** change one redirect in one controller (e.g. insert a verification
  screen before checkout). Live fleet-wide on the next tap.

## Scope decisions

Two mobile-specific caveats are accepted as scope, not treated as open problems:

1. **Online-first only.** Every navigation is a round-trip (prefetch and
   stale-while-revalidate are roadmap, [issue #1](https://github.com/yuchida-tamu/gangway/issues/1)).
   Offline-first apps are out of scope.
2. **Version skew is permanent.** A mobile fleet always contains stale clients; the
   protocol is designed around that instead of pretending deploys are atomic.

---

Next: [Getting started](getting-started.md)
