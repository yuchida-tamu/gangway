[Docs](README.md) › Versioning & updates

# Versioning & updates

A mobile fleet always contains stale clients — deploys are never atomic. Gangway treats
version skew as a permanent condition the protocol is designed around, not an error state.
This page explains the two version identifiers, the two detection points, and the one
recovery path.

## Two versions, two walls

| Identifier | Names | Changes when | Sent as |
|---|---|---|---|
| **Runtime version** | The JS↔native contract (which native modules the binary has) | You add/upgrade native code → **app-store release** | `X-Gangway-Runtime` |
| **Bundle version** | The JS bundle's capability set — effectively *the registry's key set* | You add screens → **OTA (EAS) update** | `X-Gangway-Bundle` |

- **Wall 1: native changes need a store release.** Accepted. A binary on an old runtime
  can *never* be OTA-rescued (updates are scoped per `runtimeVersion`), so the BFF must be
  able to branch or degrade per runtime — that's why the header is on every request
  ([`gangway.client(c)`](server.md#clientc)). Keep new-native-module needs rare by design.
- **Wall 2: the server names a screen the client lacks.** The interesting one — everything
  below is about it.

## The three mechanisms

### 1. Version drift (soft, background)

Every [page object](protocol.md#pageobject) carries `version` — the bundle version the
server currently expects (from [`GangwayConfig.version`](server.md#gangwayconfig)). When it
differs from the client's own `bundleVersion`, the client fires **`onVersionDrift`** and
*renders the page anyway*. Drift is a hint, not an error.

```ts
onVersionDrift: () => { Updates.checkForUpdateAsync() }   // fetch in background, apply next launch
```

### 2. Missing component (client-side detection)

The server returns a page whose `component` isn't in the registry — no server knowledge
needed. [`GangwayScreen`](react.md#gangwayscreen) renders
`<Fallback reason="missing-component">` and the update hooks let you react. This is the
default way stale clients experience a new screen: everything else keeps working; only the
new screen shows the wall.

### 3. The 409 update gate (server-side, deliberate)

For routes that must not run against an old bundle at all, gate them:

```ts
app.get('/checkout-v2', (c) => {
  const gate = gangway.requireBundle(c, '3')
  if (gate) return gate
  // ...
})
```

The client core then: fires **`onUpdateRequired`**, synthesizes a page with the reserved
component name `COMPONENT_UPDATE_REQUIRED` (`'@gangway/update-required'`), and navigates to
it — so the gate is a normal screen, not a dead tap. During
[rehydration](navigation.md#rehydration) a 409 replaces the page under the same key
instead, degrading the restored screen in place.

This is Inertia's `X-Inertia-Version` → 409 mechanism, adapted for a world where "refresh"
is asynchronous and not guaranteed.

## The recovery path: expo-updates

OTA is asynchronous: EAS updates apply on next launch by default, a forced fetch takes
seconds, and a running app can't be push-updated. The
[fallback screen](react.md#the-fallback-screen) is therefore a **first-class UX state**
("something new is here, updating…"), not an error page. Production wiring:

```ts
import * as Updates from 'expo-updates'

export const gangway = new GangwayClient({
  // ...
  onVersionDrift: () => { void Updates.checkForUpdateAsync() },
  onUpdateRequired: async () => {
    await Updates.fetchUpdateAsync()
    await Updates.reloadAsync()   // store is lost; rehydration restores the stack
  },
})
```

Note the second line's synergy: `reloadAsync()` wipes the in-memory store, and
[rehydration](navigation.md#rehydration) heals the restored stack — the user lands back
where they were, now on the new bundle. (The demo app only logs in these hooks;
expo-updates wiring is not exercised in the demo.)

Store policy: JS-only OTA is explicitly permitted by Apple (interpreted-code clause) and
Google (VM/interpreter exemption). Expo is a prerequisite of the framework precisely
because expo-updates + runtimeVersion + channels *are* this recovery story.

## The release playbook

**Adding a screen** (the case the machinery exists for):

1. Server: add the route + `Pages` entry — may deploy immediately; stale clients that hit
   the new screen get the fallback.
2. App: add the component + registry entry; bump `BUNDLE_VERSION`; `eas update`.
3. Optionally raise `createGangway({version})` so old bundles start hearing drift, and add
   `requireBundle` gates only where an old bundle would actually misbehave.

**Changing data/flow only** (the common case): deploy the BFF. No versions change, no
update needed — every installed client gets the new behavior on its next visit.

**Practical rules:**

- Use plain integer bundle versions (`'1'`, `'2'`, …) — the comparison falls back to
  lexicographic for non-numeric strings ([issue #9](https://github.com/yuchida-tamu/gangway/issues/9)).
- Gate sparingly. The missing-component fallback already covers "new screen, old client";
  `requireBundle` is for routes where *serving anything* to an old bundle is wrong.
- Never remove a registry entry in the same update that the server stops sending it —
  old servers/new clients and new servers/old clients both exist mid-deploy.

---

Back to [docs index](README.md)
