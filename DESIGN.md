# Gangway — an Inertia-style BFF framework for React Native (Expo)

*Design document, v0.1 — 2026-07-10. Working title "gangway" (a bridge onto a ship); rename freely.*

Gangway lets a backend drive a React Native app the way Inertia.js drives a web SPA: the
**server owns routing, data, and flow**; the **client owns components and rendering**. A BFF
route never sends UI trees — it sends `{component: "Orders/Show", props: {...}}` and the app
resolves that name against a registry of ordinary React Native screens shipped in the JS bundle.

This document is self-contained: an agent (or human) picking up this repo should be able to
continue from here without the original conversation.

---

## 1. Status

**Prototype / spike — protocol proven end-to-end, including a full on-device pass.**

Verified so far (see §10 for how to re-run):

- ✅ All packages and apps typecheck (`npm run typecheck`).
- ✅ 10-scenario protocol e2e passes: real client core ↔ real BFF over HTTP
  (`apps/server/test/e2e.ts`), covering visits, nav intents, server nav override,
  303-redirect-follow after POST, 422 validation, back-nav cache, in-place reload,
  missing-component wall, 409 update gate, version-drift detection.
- ✅ The Expo app bundles end-to-end through Metro/Hermes (`npm run export -w apps/mobile`).
- ✅ **Route rehydration (the reload/cold-start fix).** Routes now carry the page URL; a
  screen whose store entry was lost re-fetches in place. Verified on device: after a JS
  reload of a 3-deep stack, all three screens self-healed (`GET /`, `/orders`, `/orders/1`
  in the BFF log) and rendered real content instead of the missing-page fallback; back-nav
  afterward was served from the rehydrated cache with zero further requests. Covered by e2e
  scenarios 12–14. See §6.1.
- ✅ **Simulator pass (iOS, iPhone Air, Expo SDK 56 / Expo Go).** Every flow driven on
  device and confirmed with screenshots + BFF request logs (2026-07-11):
  - Cold boot → Home via the boot `visit('/', {intent:'replace'})`.
  - Home → Orders push nav; order detail push nav (real BFF data rendered natively).
  - Archive: POST → server 303 → list re-rendered with `replace`, archived order gone,
    server state persisted.
  - New order opens as a **native modal** purely from the server's `nav:{action:'modal'}`.
  - Empty submit → **422**, stays on the form, inline field errors render.
  - Valid submit → **303** → Orders/Show of the newly created order.
  - **Back-nav renders from the client page-object store with zero BFF requests**
    (verified against `hono/logger` output — forward navs log GETs, backs log nothing).
  - Labs → **missing-component fallback**; VIP → **409 update-required fallback**.
- ⬜ Not yet exercised: expo-updates wiring (the fallback's "Check for update" is a no-op
  in the demo), Android, real back-swipe gesture (button-back is verified), and a genuine
  OS cold-start with restored nav (only the JS-reload analog was reproduced — same store-loss
  path, so rehydration covers both, but the OS-restore route hasn't been driven directly).

### 1.1 Toolchain note

The app was migrated from Expo SDK 53 → **SDK 56** (`react-native` 0.85, `react` 19.2,
`expo-router` ~56.2) so it runs on the simulator's installed Expo Go. Nothing in the
framework packages needed to change for the bump — only `apps/mobile`.

## 2. Motivation & practicality assessment

Inertia's value proposition ports to mobile: one source of truth for routing/data/authz on the
server, no REST/GraphQL API to design or version, no client-side server-state management, and
forms that post to a route and receive validation errors for free. Two mobile-specific caveats
are accepted as **scope decisions**, not open problems:

1. **Online-first only.** Every navigation is a round-trip (mitigable later with prefetch and
   stale-while-revalidate, as Inertia v2 does). Offline-first apps are out of scope.
2. **Version skew is permanent.** A mobile fleet always contains stale clients. The protocol
   is designed around this (§8) instead of pretending deploys are atomic.

### Prior art (surveyed 2026-07, all links checked then)

| Project | Model | Status | Why it isn't this |
|---|---|---|---|
| [Rise Tools](https://github.com/rise-tools/rise-tools) | Server sends JSON component trees | Dormant since 2024-09, "do not use" | Full SDUI: huge failure surface, server owns every node |
| [Hyperview](https://hyperview.org/) | XML hypermedia (HXML), HTMX-style | Active, production at Instawork | Hypermedia, not "server routes + native client components" |
| [Expo RSC](https://docs.expo.dev/guides/server-components/) | RSC payloads | Experimental; Stack/Tabs unsupported | Server-driven *navigation* is its weakest part; unstable |
| [inertia-native](https://github.com/PedroAugustoRamalhoDuarte/inertia-native) | Inertia web app in WebViews | POC | Not native rendering |
| Airbnb Ghost, Lyft Canvas | Proprietary SDUI | Closed | Not available; also full SDUI |

The "Inertia slot" — native rendering, client-bundled screens, server routes/props/redirects —
is unoccupied. Key architectural insight: **the Inertia model minimizes the unresolvable-payload
problem by construction.** JSON-tree SDUI can fail on any node of any payload; here the server
only ever names a *screen*, so the failure surface is one registry lookup with one well-defined
fallback (§8).

## 3. Layer boundaries

```
┌─ Expo app (apps/mobile) ─────────────────────────────────────┐
│  Screen components   — ordinary RN code, shipped in bundle   │
│  Screen registry     — name → component (capability set)     │
│  Client runtime      — @gangway/client: visits, forms, cache │
│  Navigation adapter  — maps nav intents onto Expo Router     │
└──────────────────── wire protocol (§4) ──────────────────────┘
┌─ BFF (apps/server, framework home) ──────────────────────────┐
│  Routes/controllers  — resolve each URL to a page object     │
│  Flow control        — redirects, validation errors, gates   │
│  Version negotiation — per-client runtime/bundle awareness   │
└─────────────── ordinary function calls ──────────────────────┘
┌─ Backend domain ─────────────────────────────────────────────┐
│  Models/services/auth — never sees screen names or payloads  │
└──────────────────────────────────────────────────────────────┘
```

BFF and domain may be one process (as in a Laravel+Inertia app). The boundary is conceptual:
**only the BFF layer knows screen names.** The wire protocol is language-agnostic (like
Inertia's); the reference server implementation is TypeScript/Hono, chosen so the prototype can
share types end-to-end.

## 4. Contract 1 — the wire protocol

Defined in `packages/protocol` (types + header constants). Modeled on
[Inertia's protocol](https://inertiajs.com/the-protocol) with one addition (nav intents) and
two deviations (§4.4, §4.5).

### 4.1 Request

Every Gangway request carries:

| Header | Value |
|---|---|
| `X-Gangway` | protocol version, currently `1` |
| `X-Gangway-Runtime` | Expo `runtimeVersion` of the binary (native contract, §8) |
| `X-Gangway-Bundle` | capability version of the JS bundle / screen registry |

GET for visits; POST/PUT/PATCH/DELETE with a JSON body for mutations.

### 4.2 Page object (200)

```jsonc
{
  "component": "Orders/Show",        // resolved via client registry
  "props": { "order": {...}, "errors": {} },  // errors always present
  "url": "/orders/42",               // canonical URL on the BFF
  "version": "1",                    // bundle version the server currently expects
  "nav": { "action": "modal" }       // optional server override, see 4.3
}
```

`version` drift (client bundle ≠ server expectation) triggers the client's `onVersionDrift`
hook → background `Updates.checkForUpdateAsync()`. Not an error; the response still renders.

### 4.3 Navigation intents

`push | replace | resetTo | back | modal`. Resolution order:

1. `nav` in the response (server override — e.g. `resetTo` after login, `modal` for forms);
2. the intent the client initiated the visit with (`<Link intent="...">`);
3. default: `push` for GET, `replace` for mutations (so back never reopens a submitted form).

Tab/stack *structure* stays client-defined (Expo Router `_layout.tsx` files — the app shell,
analogous to Inertia persistent layouts). The server decides which screen renders and when to
redirect. Deliberately **not** letting the server define tab bars in v1: that is the slippery
slope back to full SDUI.

### 4.4 Mutations: 303 and 422

- Success → `303 See Other` to the resulting page. fetch follows it transparently, so the
  client gets the *next screen's* page object in the same round-trip.
- Validation failure → `422` with `{errors: {field: message}}`. The client stays put;
  `useForm` exposes the errors. **Deviation from web Inertia** (which redirects back with
  errors in session flash): mobile clients are assumed token-authed and sessionless, and
  skipping the redirect saves a round-trip. Revisit if cookie-session support is added.
- **Deviation 2:** no nav override on redirect responses. fetch auto-follows 303s, so
  intermediate response headers are unreadable (RN fetch lacks reliable `redirect: 'manual'`).
  Nav overrides therefore live on page objects only — the redirect *target* declares its
  presentation. Keep this constraint in mind when designing new protocol features.

### 4.5 Update gate: 409

When a route requires a newer bundle (`gangway.requireBundle(c, '2')`), the server responds
`409` + `X-Gangway-Update-Required: <minBundle>` + `{updateRequired, minBundle, message?}`.
The client core synthesizes a page with the reserved component name
`@gangway/update-required`, navigates to it (so the UX is a normal screen, not a dead tap),
and fires `onUpdateRequired` → `Updates.fetchUpdateAsync()` + `reloadAsync()` in production.

This is Inertia's `X-Inertia-Version` → 409 mechanism adapted for a world where the "refresh"
is asynchronous and not guaranteed (§8).

## 5. Contract 2 — components

The client's screen registry is its half of the contract:

```tsx
// apps/mobile/src/registry.tsx
export const registry: ScreenRegistry = {
  'Home': Home,
  'Orders/Index': OrdersIndex,   // keys must match BFF component names
  ...
}
```

The server's half is a **page map type** — the single source of truth for what each screen
receives:

```ts
// apps/server/src/index.ts
export type Pages = {
  'Orders/Show': { order: Order }
  ...
}
const gangway = createGangway<Pages>({ version: '1' })
gangway.page(c, 'Orders/Show', { order })          // ✗ compile error if props mismatch
```

The app imports `Pages` **type-only** (`PageProps<'Orders/Show'>` in
`apps/mobile/src/gangway.ts`, via the `@demo/server` tsconfig path alias) — erased at build
time, so Metro never bundles server code, but screens are typechecked against controllers.
This beats web Inertia's DX, where the PHP/Ruby side can't share types.

## 6. Contract 3 — navigation mapping (the spike)

The Expo Router integration convention (`packages/client/src/expoRouterAdapter.ts`):

- The host app declares two catch-all routes rendering `<GangwayScreen/>`:
  `app/s/[key].tsx` (card) and `app/m/[key].tsx` (modal, presentation set in `_layout.tsx`).
- Each successful visit stores its page object in the client store under a generated key and
  navigates to `/s/<key>` (or `/m/<key>`). **The native stack holds keys; page objects live in
  the store.** Going back pops to a previous key whose page object is still cached — **no
  refetch on back**, matching native expectations. (Verified in e2e scenario 6; screen-level
  behavior still needs a simulator pass.)
- `resetTo` = `dismissAll()` + `replace`. `reload(key)` refetches in place (pull-to-refresh).

### 6.1 Route rehydration (store-loss recovery)

The store is in-memory; native routes outlive it. When the JS reloads (dev Fast Refresh, a
production OTA `reloadAsync()`, or a cold start where the OS restores navigation) the store is
empty but the routes come back. To keep restored routes from resolving to dead keys, each
route carries **both** its key and the page's canonical URL:

- The adapter navigates to `/s/[key]` (or `/m/[key]`) with `params: { key, u: page.url }`.
  The URL used is the page object's `url` — i.e. the *post-redirect* URL after a 303 — so a
  route created by a form POST rehydrates from the resource it landed on, not the POST target.
- `GangwayScreen` reads `pageKey` + `url`. If the store has no page for `pageKey` **and** a
  `url` is present, it calls `client.rehydrate(pageKey, url)` in an effect and renders
  `<Fallback reason="rehydrating">` (a spinner, not an error) until the store fills. No `url`
  (e.g. a synthetic route) → the terminal `missing-page` fallback.
- `rehydrate(key, url)` GETs the URL and writes the page under the **existing** key **without
  navigating** (unlike `visit`, which mints a new key and pushes). It is idempotent per key
  (in-flight guard) and a no-op if the page is already present. A 409 during rehydrate stores
  the update-required fallback under that same key, so a gated screen degrades in place.
- Every screen in a restored stack rehydrates independently as it mounts, so the whole stack
  self-heals; back-nav across already-rehydrated screens stays cache-only (no refetch).
- **Key collisions across reloads** are prevented by seeding each key with a per-session tag
  (`g<base36-time>_<seq>`). Without it, the `seq` counter resets to 1 on reload and a fresh
  visit could overwrite a restored route's page under a colliding `g1`.

This same mechanism is the basis for OS deep links / notifications (open question §11): an
inbound URL becomes a route with a `u` param that rehydrates on arrival. What it does **not**
yet do is reconstruct a *back stack* for a cold deep-link — that still needs a server stack
hint (§11 #1).

## 7. What development feels like

- **Data/flow change** (common case): edit a controller. Deploy the BFF. Every client —
  including already-installed binaries — gets the new behavior on next visit. No release.
- **New screen:** add controller returning `page('X', props)` + RN component + registry entry;
  bump client bundle version; `eas update`. Server can start returning `X` immediately —
  stale clients hit the fallback (§8) until their OTA lands.
- **Flow experiment:** change a redirect in one controller (e.g. insert a verification screen
  before checkout). This is the Lyft-style "ship UX without releasing" payoff, but screens
  remain ordinary native code.

## 8. The two walls, addressed

**Wall 1 — native layer changes require a store release.** Accepted; Expo's `runtimeVersion`
names the JS↔native contract. Consequences the framework owns: clients send
`X-Gangway-Runtime` on every request; the fleet is permanently heterogeneous (a binary on an
old runtime can *never* be OTA-rescued, since updates are scoped per runtimeVersion); the BFF
must be able to branch or degrade per runtime. Keep new-native-module needs rare by design.

**Wall 2 — server names a screen the client lacks.** Two detection points, one recovery path:

- *Client-side (primary, zero server knowledge needed):* registry lookup misses →
  `<Fallback reason="missing-component">` renders + `onUpdateRequired` hook fires.
- *Server-side (deliberate gating):* `requireBundle()` → 409 → same fallback screen.
- *Recovery:* `Updates.fetchUpdateAsync()` → `reloadAsync()`. **OTA is asynchronous** — EAS
  updates apply on next launch by default, a forced fetch takes seconds, and a running app
  can't be push-updated. The fallback screen is therefore a first-class UX state ("something
  new is here, updating…"), not an error page. Store-policy note: JS-only OTA is explicitly
  permitted by Apple (interpreted-code clause) and Google (VM/interpreter exemption).

Expo is a prerequisite of the framework precisely because expo-updates + runtimeVersion +
channels are this recovery story.

## 9. Repo layout

```
packages/protocol   wire types + header constants (no runtime deps)
packages/server     createGangway(): page/redirect/errors/updateRequired/requireBundle; Hono adapter
packages/client     core.ts (transport+store+visit machine, no React — e2e-testable in Node)
                    bindings.tsx (Provider, GangwayScreen, usePage, useForm, useVisit)
                    Link.tsx, expoRouterAdapter.ts
apps/server         demo BFF exercising every protocol path (see file header for route map)
apps/mobile         Expo app: registry, screens, catch-all routes, fallback screen
```

Packages ship TS source directly (`main: ./src/index.ts`); Metro and tsx both consume it.
Publishing real npm packages will need a build step — irrelevant at this stage.

## 10. Running & verifying

```sh
npm install
npm run typecheck        # all workspaces
npm run test:e2e         # 10-scenario protocol test (client core vs real BFF over HTTP)
npm run dev:server       # BFF on :3939 (open in a browser for the debug HTML view)
npm run dev:mobile       # Expo dev server; press i for iOS simulator
npm run export -w apps/mobile   # Metro/Hermes bundle check without a device
```

Demo walkthrough on device: Home (stats) → View orders → order → Archive (POST → 303 →
back on refreshed list) → New order (server-declared modal; submit empty to see 422 errors) →
Labs (missing-component fallback) → VIP (409 update-required fallback).

## 11. Roadmap & open questions

Near-term (spec exists in Inertia, port deliberately deferred):
- Partial reloads (`X-Inertia-Partial-Data` analog) and deferred props — skeleton-then-fill.
- Prefetch on press-in + page-object cache with stale-while-revalidate — kills perceived latency.

Open design questions:
1. **Cold deep-link back-stack reconstruction** (the remaining half of the old store-vs-nav
   issue; single-screen store-loss recovery is DONE — see §6.1). Rehydration heals whatever
   routes the OS restored, but a *cold* deep link / notification tap opens a single route with
   no stack beneath it, so "back" has nowhere to go. Fix direction: the server provides a
   stack hint for cold-start entries, e.g. `{stack: ['/','/orders','/orders/42']}`, which the
   adapter expands into a synthetic back stack (each entry a rehydratable `u` route). Until
   then, a deep-linked screen rehydrates and renders fine but back may exit the app.
2. **Auth:** current assumption is token + fetch wrapper (client core accepts a custom `fetch`).
   Cookie-session support would unlock true Inertia-style flash/errors-on-redirect (§4.4).
3. **Header/title control:** confirmed needed in the pass — every screen's native header reads
   "Gangway" (hardcoded in `_layout.tsx`), so the back button and title are identical across
   screens. Server should set titles (`props.title` → `Stack.setOptions`) — small, high-value.
4. **Scroll restoration** on back; **optimistic UI** for mutations; **WS transport** for
   Rise-style live props (protocol already isolates transport in `GangwayClient`).
5. **Page-object GC:** the store currently grows with the session (fine for a prototype;
   evict on stack unwind later — needs a router-events hook in the adapter).
6. **Registry codegen:** generate the registry + capability hash from the `Pages` type or a
   screens directory, so client bundle version bumps are automatic, not manual.

## 12. Positioning (for a future README)

- vs **REST/GraphQL + client routing:** no API layer to design; server controls flow; but you
  give up offline and accept per-navigation round-trips.
- vs **full SDUI (Rise/Ghost):** screens are real native code with full expressiveness; the
  version-skew failure surface is one registry lookup, not every payload node.
- vs **Hyperview:** same "server drives the app" goal, but you write React Native components
  and TypeScript controllers instead of HXML documents.
- vs **Expo RSC:** available today on stable Expo, works with EAS Update (RSC currently
  doesn't), and treats server-driven *navigation* as the core feature rather than a gap.
