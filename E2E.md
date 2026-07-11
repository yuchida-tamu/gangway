# Gangway — on-device E2E scenarios (demo app)

The regression suite you run **on the simulator** against `apps/mobile` + the demo BFF. It
catches breakage the headless protocol test can't — anything in the React Native / Expo Router
integration layer (route-param plumbing, screen resolution, modal presentation, the rehydrate
effect, fallback rendering).

**Two suites, run both before calling a change safe:**

| Suite | File | Runs where | Catches |
|---|---|---|---|
| Protocol e2e | `apps/server/test/e2e.ts` (`npm run test:e2e`) | Node, headless | Client-core logic vs. real BFF: visits, 303/422/409, nav intents, cache, rehydrate |
| **Device e2e (this doc)** | `E2E.md` | iOS simulator, Expo Go | RN integration: navigation feel, modal, forms, fallbacks, on-device rehydration |

Every device scenario below names the protocol-e2e scenario it mirrors (or "device-only" when
it exercises something the Node test can't reach).

---

## 0. Automated harness (the fast path)

Most of this doc is executed for you by **`scripts/e2e-device.sh`** — it drives the scenarios
via `agent-device` and prints pass/fail per scenario, exiting non-zero if any fail.

```sh
# Prereqs: an iOS simulator booted, agent-device on PATH, Metro reachable (or it will start it).
npm run test:e2e:device            # restarts the BFF, reuses/starts Metro, cold-boots, runs all
npm run test:e2e:device -- --keep  # same, but leave the servers running afterward
ONLY="A1 A2 B3" bash scripts/e2e-device.sh   # run just some scenarios (fast iteration)
```

The harness owns the **BFF** (restarts it each run so orders reseed deterministically and its
request log is captured to `/tmp/gangway-e2e-bff.log`) and asserts on that log to prove
cache/rehydration behavior. It **reuses** an already-running Metro on `:8081`, or starts one.
Scenarios that need a JS reload (E1) briefly append a line to `apps/mobile/src/gangway.ts` and
revert it via an EXIT trap.

The rest of this doc is the **manual/reference** form: the exact steps, selectors, and expected
results the harness automates — read it to debug a failure or to add a scenario (then add the
matching `scn_*` function to the script).

**Gotchas the harness already handles** (worth knowing if you drive by hand): a stale
`agent-device` session must be cleared with `close --session default` before `open`, or
snapshots return empty; a FlatList row is a `[scroll-area]` whose child `[cell]` reads "same
label as parent", so press the interactive node *at or after* the labelled line, not the
scroll-area; the Expo dev menu can overlay a cold boot and must be dismissed first.

---

## 1. Prerequisites

- Xcode iOS simulator available; an iPhone booted (`xcrun simctl list devices booted`).
- `agent-device >= 0.19.1` on PATH (`agent-device --version`). Scenarios use it for reliable
  label/text-based interaction; you can also drive them by hand.
- Expo Go matching the app's SDK (56) installed in the simulator. `npx expo start --ios`
  installs the right one on first launch; accept the prompt (or run non-CI so it auto-installs).

## 2. Environment setup

Run each in its own shell from the repo root. **Capture the BFF log** — several scenarios
assert on it.

```sh
# 1. BFF on :3939, with request logging tee'd to a file.
npm run dev:server 2>&1 | tee /tmp/gangway-bff.log

# 2. Metro / Expo dev server on :8081 (leave running).
npm run dev:mobile

# 3. Cold-boot the app with a FRESH store (terminate Expo Go first, then deep-link).
xcrun simctl terminate booted host.exp.Exponent
xcrun simctl openurl booted "exp://127.0.0.1:8081"
# wait for "Bundled" in the Metro output, then dismiss the Expo dev menu if it appears.

# 4. Attach agent-device.
agent-device open host.exp.Exponent
agent-device snapshot -i        # if a dev menu shows, press its "Close"/"Continue"
```

### Determinism / reset

- The BFF keeps orders **in memory** and they mutate (archive, create). **Restart the BFF**
  (step 1) before a full run to reseed the two open orders: `Aluminum extrusions ¥1,200` and
  `M5 hex bolts (x500) ¥89`.
- A **cold boot** (step 3, terminate → deep-link) resets the client's in-memory page store and
  gives the boot flow (`visit('/', {intent:'replace'})`). Use it to start any run clean.

## 3. Conventions

- **Selectors:** prefer durable ones — `press 'label="View orders"'`, `wait text "…"`. Get
  fresh `@eN` refs from `snapshot -i` when a label is ambiguous.
- **Text fields have no accessibility labels** (only placeholders, which agent-device does not
  match as labels). Always `snapshot -i` and `fill` the `[text-field]` **by `@ref`**; the refs
  shift after a 422 renders error rows, so re-snapshot between fills if a `fill` reports no effect.
- **Asserting screen identity:** the native header title is hardcoded `"Gangway"` on every
  screen (known gap — DESIGN.md §11 #3), so **never** assert on the title. Assert on unique
  **body** text (`wait text "Aluminum extrusions"`).
- **Back button:** `press 'role=button label="Gangway"'` (the title is `text`, the back button
  is `button` — same label, different role).
- **BFF-log assertions:** `tail -n <k> /tmp/gangway-bff.log`. `<-- GET /x` / `--> GET /x 200`
  is one request. "No new lines" is the assertion for cache hits.
- Each scenario lists **Pre** (precondition), **Do** (steps), **Expect** (UI + log).

---

## 4. Scenario catalog

### Group A — Navigation

**A1. Cold boot → Home** · _mirrors protocol #1_
- Pre: cold boot (setup step 3).
- Do: observe first screen.
- Expect: body shows `Gangway demo BFF`, `Open orders: 2`, `View orders`, `Labs …`, `VIP …`.
  BFF log: `GET /` → 200. (Boot did `visit('/', {intent:'replace'})`.)

**A2. Home → Orders (push)** · _mirrors #2_
- Pre: A1.
- Do: `press 'label="View orders"'`.
- Expect: `wait text "Orders"` and both order rows visible; a back button appears (pushed onto
  the stack). BFF log: `GET /orders` → 200.

**A3. Order detail (push)** · _mirrors #2_
- Pre: A2.
- Do: `press 'label="Aluminum extrusions, ¥1,200 · 2026-07-01"'` (or the row's `@ref`).
- Expect: `wait text "Amount: ¥1,200"`, `Status: open`, `Archive` visible. BFF: `GET /orders/1`.

### Group B — Mutations & forms

**B1. Archive (POST → 303 → replace)** · _mirrors #5/#7-ish_
- Pre: A3 on order 1.
- Do: `press 'label="Archive"'`.
- Expect: lands on the **Orders list** (not the detail), and `Aluminum extrusions` is **gone**
  (only `M5 hex bolts` remains). BFF log shows a POST then the redirected GET:
  `POST /orders/1/archive` → 303, then `GET /orders` → 200. Because the mutation defaulted to
  `replace`, back does not reopen the detail.

**B2. New order opens as a native modal** · _mirrors #3_
- Pre: on the Orders list (e.g. after B1, or A2).
- Do: `press 'label="New order"'`.
- Expect: a **modal** sheet slides up (the list is visible behind the rounded top). Body shows
  `New order`, `Title`, `Amount (¥)`, `Create order`. BFF: `GET /orders/new`. The modal
  presentation comes purely from the server's `nav:{action:'modal'}` — the client didn't choose it.

**B3. Empty submit → 422, inline errors, stays put** · _mirrors #4_
- Pre: B2 (modal open, fields empty).
- Do: `press 'label="Create order"'`.
- Expect: still on the form; `wait text "Title is required."` and `wait text "Amount must be a
  positive number."`. BFF: `POST /orders` → 422. No navigation occurred.

**B4. Valid submit → 303 → new detail** · _mirrors #5_
- Pre: B2 (modal open).
- Do: `snapshot -i`; `fill` the first `[text-field]` (`@ref`) `"Steel plate 3mm"`; re-`snapshot
  -i`; `fill` the amount `[text-field]` (`@ref`) `"480"`; `press 'label="Create order"'`.
- Expect: modal dismisses; `wait text "Steel plate 3mm"` and `Amount: ¥480`, `Created: <today>`.
  BFF: `POST /orders` → 303, then `GET /orders/<newId>` → 200.

### Group C — Caching (back navigation)

**C1. Back-nav renders from cache (no refetch)** · _mirrors #6_
- Pre: on a detail screen reached via A3 (note current BFF log length).
- Do: `press 'role=button label="Gangway"'` (back).
- Expect: previous screen (Orders list) shows instantly. BFF log: **no new lines** — the page
  object rendered from the client store.

### Group D — Fallback walls (the version-skew story)

**D1. Missing-component fallback** · _mirrors #8_
- Pre: Home (A1).
- Do: `press 'label="Labs (screen this bundle doesn't have — fallback demo)"'`.
- Expect: `wait text "Update available"` and the body naming the unresolved screen: `… (Labs/Future)
  … doesn't include yet …`. BFF: `GET /labs` → **200** (server sent a real page; the client
  couldn't resolve the component → fallback).

**D2. 409 update-required fallback** · _mirrors #9_
- Pre: Home (A1).
- Do: `press 'label="VIP (server gate — 409 update-required demo)"'`.
- Expect: `wait text "This feature needs app bundle 2 or later."`. BFF: `GET /vip` → **409**.

### Group E — Route rehydration (store-loss recovery) · _device-only; logic mirrors #12–14_

**E1. Restored stack self-heals after JS reload**
- Pre: build a stack — A1 → A2 → A3 (Home → Orders → detail).
- Do: force a full JS reload that wipes the in-memory store while Expo Router restores the
  stack. Either: dev menu → **Reload**, OR append a comment to `apps/mobile/src/gangway.ts`
  (triggers a full reload via Fast Refresh), OR `xcrun simctl` Cmd+R with hardware keyboard.
- Expect: after the reload the detail screen shows **real content** (`wait text "Amount:
  ¥1,200"`), briefly preceded by a `Restoring…` spinner — **not** `This screen's data is no
  longer available`. BFF log shows the whole stack rehydrating: `GET /`, `GET /orders`,
  `GET /orders/1` (each restored screen re-fetches its `u` param). _Regression guard for the
  route-param plumbing: if `u` stops being passed, this reverts to the missing-page fallback._

**E2. Back-nav after rehydration stays cache-only**
- Pre: E1 (stack rehydrated).
- Do: note BFF log length; `press 'role=button label="Gangway"'`.
- Expect: Orders list shows; **no new BFF lines** (the lower screen was already rehydrated).

### Group F — Pull-to-refresh (in-place reload) · _device-only; logic mirrors reload()_

**F1. Pull-to-refresh reflects server state**
- Pre: on the Orders list (A2) showing 2 orders; in another shell archive one via
  `curl -s -X POST -H 'X-Gangway: 1' -H 'X-Gangway-Bundle: 1' localhost:3939/orders/2/archive`.
- Do: pull the list down (`scroll` down at the top, or trigger `RefreshControl`).
- Expect: the archived row disappears without navigating. BFF: `GET /orders` → 200 under the
  **same** route (no push). Confirms `reload(key)` refetches in place.

### Group G — Cache staleness on back (a real limitation, demonstrated)

**G1. Back shows a stale cached screen** · _device-only; the cost of C1's cache-on-back win_
- Pre: reseed the BFF; cold boot.
- Do: View orders → open "Aluminum extrusions" → **Archive** (POST→303→**replace** to a fresh
  list without it) → press **Back**.
- Expect: you land on the *original* cached Orders list, which **still shows "Aluminum
  extrusions"** even though it's archived, and the BFF gets **zero** requests. Both facts in one
  assertion: back is served from the store (fast, native-feeling) *and* the store can be stale.
- Why it's here: the harness celebrates C1 (back = 0 refetches); G1 is the honest flip side.
  It's the regression target for any staleness mitigation we add (reload-on-focus, server cache
  invalidation, `WhenVisible`/poll).

### Group H — Client-only animation (no server state)

**H1. Tap-to-reveal animates with zero server involvement** · _device-only_
- Pre: on an order detail screen.
- Do: tap **Show timeline** (an `Animated` fade+slide reveal in `ui.tsx`'s `<Reveal>`), then
  **Hide timeline**.
- Expect: "Order timeline" animates in and is visible; after Hide it animates out and unmounts;
  the BFF gets **zero** requests across the whole interaction.
- What E2E can and can't assert: it verifies the **end states** (revealed / hidden) and that the
  animation is **pure client** (no requests) — it does **not** assert smoothness/fps/easing,
  which snapshots can't see. "We can express animations" = confirmed; "it looks good" = eyeball it.

### Group I — In-place server action (server state without navigation)

**I1. Reaction counter writes server state without navigating** · _mirrors protocol #15_
- Pre: reseed the BFF; cold boot; open an order detail (shows `Reactions: 0`).
- Do: tap the **♥ / "Add reaction"** control.
- Expect: the count becomes the **server-confirmed** `Reactions: 1` (the heart pulses via
  `Animated`), you're **still on the detail** (Archive still visible), and the BFF log shows
  `POST /orders/1/react` with **no page GET** — i.e. a real server write with **zero
  navigation**. This is the `useAction()` / `action()` primitive: the escape hatch from the
  page-object model for like/toggle/counter widgets. The animation is client-side; the value it
  animates to comes from the server.

---

## 5. Smoke path (minimal ordered run)

When you just need a fast "did I break the happy path": **A1 → A2 → A3 → B1 → B2 → B3 → C1 →
D1 → D2 → E1 → E2.** Restart the BFF first (reseed), cold-boot, then run top to bottom.

## 6. Teardown

```sh
agent-device close
# Ctrl-C the BFF and Metro shells, or:
pkill -f "tsx watch src/index.ts"; pkill -f "expo start"
# If you edited gangway.ts for E1, revert it: git checkout apps/mobile/src/gangway.ts
```

## 7. Known gotchas / flakes

- **Expo dev menu** overlays on cold boot / after shake — press its `Close`/`Continue` first
  (`snapshot -i` will show it). It is not part of the app.
- **Expo Go SDK mismatch** ("Project is incompatible with this version of Expo Go") means the
  installed Expo Go ≠ SDK 56; let `expo start --ios` install the matching client.
- **Header title is always "Gangway"** — assert on body text, never the title (§3).
- **Modal field refs shift** after a 422 renders error rows; re-`snapshot -i` before filling
  in B4 if a `fill` reports no effect.
- **`booted` vs. a specific udid:** screenshots/openurl use `booted`; if idb/agent-device
  targets the wrong device, pass the udid of the actually-booted sim explicitly.
- **Wrong-device taps:** confirm the booted device (`xcrun simctl list devices booted`) matches
  what agent-device drives; a mismatch makes taps silently miss.
- **`accessibilityLabel` masks inner text:** a `Pressable` with an `accessibilityLabel` hides
  its children's text from `snapshot`/`wait text`. Keep any text you need to assert (e.g. a
  counter value) in a **sibling** node, not inside the labelled pressable (see the reaction
  widget in `OrdersShow`).
- **Stale JS after an edit:** a freshly-restarted Metro can serve a half-built bundle to the
  first cold boot, running old code. The harness now **warms the bundle** (one `entry.bundle`
  fetch) right after starting Metro. If you drive by hand after editing demo code, wait for
  Metro's "Bundled" line before relaunching, or restart Metro.
