# Gangway documentation

Gangway is an [Inertia.js](https://inertiajs.com)-style BFF framework for React Native
(Expo). The **server owns routing, data, and flow**; the **app owns components and
rendering**. A BFF route never sends UI trees — it sends
`{component: "Orders/Show", props: {...}}`, and the app resolves that name against a
registry of ordinary React Native screens shipped in the JS bundle.

> **Status:** prototype. Not published to npm; APIs are unstable. These docs describe the
> current source in this repository. [DESIGN.md](../DESIGN.md) remains the design source of
> truth; known gaps are tracked in the [issue list](https://github.com/yuchida-tamu/gangway/issues).

## Pages

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Build a minimal BFF + Expo app pair from scratch |
| [Concepts & architecture](concepts.md) | The layer model, the three contracts, the life of a visit |
| [Wire protocol](protocol.md) | `@gangway/protocol` — headers, the page object, status codes |
| [Server API](server.md) | `@gangway/server` — `createGangway()` and every response helper |
| [Client core API](client-core.md) | `@gangway/client/core` — `GangwayClient`, visits, the page store |
| [React bindings](react.md) | Provider, `GangwayScreen`, `usePage`, `useForm`, `useAction`, `Link` |
| [Navigation](navigation.md) | Nav intents, the Expo Router adapter, rehydration, custom adapters |
| [Versioning & updates](versioning.md) | Bundle/runtime versions, drift, the 409 gate, fallback UX, OTA |

## Which module is in charge of what

| Module | Responsibility |
|---|---|
| `@gangway/protocol` | The wire contract only: TypeScript types, header constants, type guards. No runtime logic, no dependencies. |
| `@gangway/server` | The BFF half of the protocol as a [Hono](https://hono.dev) adapter: build page objects, redirects, validation errors, and update gates. |
| `@gangway/client/core` | The router- and React-free client runtime: HTTP transport, the page-object store, and the visit state machine. Runs in plain Node. |
| `@gangway/client` | Everything above **plus** the React bindings (provider, screen host, hooks, `Link`) and the Expo Router adapter. |
| Your BFF (`apps/server` in the demo) | Routes/controllers: resolve each URL to a page object, decide redirects and gates. Owns the `Pages` type — the typed component contract. |
| Your Expo app (`apps/mobile` in the demo) | Screens, the screen registry, the fallback screen, layout structure (stacks/modals), and the two catch-all routes Gangway renders into. |

## Reading order

If you're new: [Concepts](concepts.md) first (10 minutes, no code), then
[Getting started](getting-started.md). The remaining pages are references — reach for them
per module. For the "why" behind the design — prior art, version-skew strategy, roadmap —
read [DESIGN.md](../DESIGN.md) and the visual explainer [HOW-IT-WORKS.md](../HOW-IT-WORKS.md).
