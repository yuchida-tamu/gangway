# gangway — agent notes

Inertia-style BFF framework prototype for React Native/Expo. **DESIGN.md is the source of
truth** — read it before changing protocol or navigation behavior; update it when you do.

## Commands

- `npm run typecheck` — tsc across all workspaces (editor tsserver diagnostics in this repo
  are unreliable for the RN app; trust the CLI).
- `npm run test:e2e` — the protocol test (`apps/server/test/e2e.ts`). Run after ANY change to
  packages/protocol, packages/server, or packages/client/src/core.ts. Extend it when adding
  protocol features.
- `npm run dev:server` — demo BFF on :3939.
- `npm run export -w apps/mobile` — Metro/Hermes bundle check without a simulator.

## Conventions

- `packages/client/src/core.ts` must stay free of React/React Native imports — it is
  e2e-tested in plain Node via the `@gangway/client/core` export.
- Protocol changes touch three places in lockstep: `packages/protocol`, the server helpers,
  the client core — plus DESIGN.md §4 and the e2e test.
- Workspace packages ship raw TS (`main: ./src/index.ts`); do not add a build step without
  checking Metro + tsx still resolve.
- `apps/mobile` imports the demo server's `Pages` type **type-only** via the `@demo/server`
  path alias. Never import server values into the app — Metro would try to bundle Hono.
- Gotcha: `apps/server/src/index.ts` auto-listens unless `NODE_ENV=test`; ESM import hoisting
  means tests must set env before a *dynamic* import (see e2e.ts).
