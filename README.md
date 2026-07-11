# gangway

**Inertia.js for React Native (Expo)** — prototype. The backend owns routing, data, and flow;
the app owns components. A BFF route returns `{component: "Orders/Show", props: {...}}`; the
app resolves the name against a registry of ordinary React Native screens and renders natively.

> 👉 **New here? Read [HOW-IT-WORKS.md](./HOW-IT-WORKS.md)** ([日本語](./HOW-IT-WORKS.ja.md)) — a
> visual explainer with diagrams that render right here on GitHub. Skim the 2-minute pitch, or
> expand any section for the architecture. Then **[DESIGN.md](./DESIGN.md)** is the full spec
> (protocol, layer boundaries, version-skew strategy, roadmap).
>
> **User documentation lives in [docs/](./docs/README.md)** — getting started, concepts, and
> per-module API references (protocol, server, client core, React bindings, navigation,
> versioning).

## Quick start

```sh
npm install
npm run test:e2e      # headless protocol e2e: client core vs real BFF over HTTP
npm run dev:server    # demo BFF on http://localhost:3939 (browser gets a debug view)
npm run dev:mobile    # Expo dev server (run the BFF first)
```

Two test suites guard the project: the headless `npm run test:e2e`, and the on-device
scenario runbook in **[E2E.md](./E2E.md)** (simulator + Expo Go). Run both before landing a
change.

## Layout

| Path | What |
|---|---|
| `packages/protocol` | Wire contract: page object types, headers |
| `packages/server` | BFF helpers (`page`, `redirect`, `errors`, `requireBundle`) + Hono adapter |
| `packages/client` | Client runtime: visit machine, `useForm`, screen registry, Expo Router adapter |
| `apps/server` | Demo BFF exercising every protocol path |
| `apps/mobile` | Demo Expo app |

Working title; not published to npm; APIs unstable.
