# gangway

**Inertia.js for React Native (Expo)** — prototype. The backend owns routing, data, and flow;
the app owns components. A BFF route returns `{component: "Orders/Show", props: {...}}`; the
app resolves the name against a registry of ordinary React Native screens and renders natively.

Read **[DESIGN.md](./DESIGN.md)** first — it is the source of truth for the protocol, the
layer boundaries, the version-skew strategy, and the roadmap.

## Quick start

```sh
npm install
npm run test:e2e      # protocol e2e: client core vs real BFF over HTTP
npm run dev:server    # demo BFF on http://localhost:3939 (browser gets a debug view)
npm run dev:mobile    # Expo dev server (run the BFF first)
```

## Layout

| Path | What |
|---|---|
| `packages/protocol` | Wire contract: page object types, headers |
| `packages/server` | BFF helpers (`page`, `redirect`, `errors`, `requireBundle`) + Hono adapter |
| `packages/client` | Client runtime: visit machine, `useForm`, screen registry, Expo Router adapter |
| `apps/server` | Demo BFF exercising every protocol path |
| `apps/mobile` | Demo Expo app |

Working title; not published to npm; APIs unstable.
