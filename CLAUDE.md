# gangway — agent notes

Inertia-style BFF framework prototype for React Native/Expo. **DESIGN.md is the source of
truth** — read it before changing protocol or navigation behavior; update it when you do.

## Commands

- `npm run typecheck` — tsc across all workspaces (editor tsserver diagnostics in this repo
  are unreliable for the RN app; trust the CLI).
- `npm run test:e2e` — the headless protocol test (`apps/server/test/e2e.ts`). Run after ANY
  change to packages/protocol, packages/server, or packages/client/src/core.ts. Extend it when
  adding protocol features.
- **`E2E.md`** — the on-device scenario runbook (simulator + Expo Go, driven with
  `agent-device`). Run after changes to the RN integration layer (bindings.tsx, the adapter,
  `apps/mobile` routes/screens) — the headless test can't catch those. Add a scenario there
  when adding a user-facing flow. Both suites should pass before a change is "safe".
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
  means tests must set env before a _dynamic_ import (see e2e.ts).

## QA Rules

Use agent-device only for app/device automation tasks. Before planning commands, run `agent-device --version` and read `agent-device help workflow`. For exploratory QA, read `agent-device help dogfood`. For logs, network, audio, traces, or runtime failures, read `agent-device help debugging`. For React Native component trees, props/state/hooks, slow renders, or rerenders, read `agent-device help react-devtools`. For React Native JavaScript heap growth, heap snapshots, or retained-object leaks, read `agent-device help cdp`. For React Native apps, overlays, Metro/Fast Refresh blockers, and routing to React DevTools or debugging evidence, read `agent-device help react-native`.

Use MCP tools or the CLI in the integrated terminal. If `agent-device` is not on PATH but the user installed it globally in another shell, resolve the command the same way the user would from a normal terminal session and run that absolute path instead. This may require inspecting shell startup behavior or package-manager/global bin locations; do not assume the agent process `PATH` is the user's `PATH`. Do not silently fall back to `npx -y agent-device@latest`; ask or use an exact version. MCP exposes structured tools backed by the agent-device client; it does not expose generic shell execution. Prefer `open -> snapshot -i -> act -> re-snapshot -> verify -> close`. Use current refs such as `@e3` for exploration and selectors for durable replay. Keep mutating commands against one session serial. Capture screenshots, logs, network, audio, perf, traces, recordings, and `.ad` replay scripts only when they add evidence.
