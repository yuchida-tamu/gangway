[Docs](README.md) › Navigation

# Navigation

This page covers Gangway's third contract: how abstract **nav actions** land on a real
navigator, the Expo Router adapter convention, and rehydration (how a restored stack heals
itself after the in-memory store is lost).

The division of labor is deliberate:

- **The client defines structure** — stacks, tabs, modals live in your `_layout.tsx` files
  (the app shell, analogous to Inertia's persistent layouts).
- **The server decides which screen renders and when to redirect** — and may express *how*
  a screen should be presented (`nav: {action: 'modal'}`), but never what the shell looks
  like.

## Nav actions

```ts
type NavAction = 'push' | 'replace' | 'resetTo' | 'back' | 'modal'
```

| Action | Meaning | Typical use |
|---|---|---|
| `push` | Add the screen to the stack | Default for GET visits (links) |
| `replace` | Swap the current screen | Default after mutations — back never reopens a submitted form |
| `modal` | Present as a native modal | Forms; usually a server override on the form's page |
| `resetTo` | Unwind the stack, make this the root | After login/logout, "start over" flows |
| `back` | Pop | Rarely sent by servers; completes the vocabulary |

### How the nav action is chosen

For every successful visit, resolution order is:

1. **`nav` on the page object** — the server override (e.g. `resetTo` after login,
   `modal` for `/orders/new`);
2. **the client's intent** — `<Link intent="replace">` or `visit(url, {intent})`;
3. **the default** — `push` for GET, `replace` for mutations.

Remember [protocol deviation 2](protocol.md#deviation-2-no-nav-overrides-on-redirects):
overrides only work on page objects, not on 303 redirect responses — the redirect *target*
declares its presentation.

## The Expo Router adapter

`createExpoRouterAdapter()` implements [`RouterAdapter`](client-core.md#routeradapter) on
Expo Router's imperative API. Its convention: the host app declares **two catch-all
routes**, both rendering `<GangwayScreen/>`:

| Route | Presentation |
|---|---|
| `app/s/[key].tsx` | Card (standard stack screen) |
| `app/m/[key].tsx` | Modal — declared via `options={{ presentation: 'modal' }}` in `_layout.tsx` |

Every successful visit stores its page object under a generated key and navigates to
`/s/<key>` (or `/m/<key>` for `modal`) with params `{ key, u: page.url }`:

- **`key`** — how the mounted screen finds its page object in the store. The native stack
  holds keys; page data lives in the store. Going back pops to a previous key whose page is
  still cached — **no refetch on back.**
- **`u`** — the page's canonical BFF URL, the seed for rehydration (below).

Action mapping: `push` → `router.push`, `replace` → `router.replace`, `modal` →
`router.push` on the `/m/` route, `resetTo` → `dismissAll()` + `replace`, `back` →
`router.back()`.

## The boot screen

Something has to perform the first visit. The convention is a minimal `app/index.tsx` that
visits `/` with `intent: 'replace'` — making **the BFF decide what the first screen is**
(and letting it answer differently per session state, e.g. `resetTo` a login page):

```tsx
export default function Boot() {
  const visit = useVisit()
  useEffect(() => { visit('/', { intent: 'replace' }) }, [visit])
  return <ActivityIndicator />
}
```

This is also the natural place to surface "can't reach the server" on cold start — check
the visit result, as the demo's `apps/mobile/app/index.tsx` does.

## Rehydration

The page store is in-memory; native routes outlive it. After a JS reload (dev Fast
Refresh), a production OTA `reloadAsync()`, or a cold start where the OS restores
navigation, the routes come back but the store is empty. Without recovery, every restored
screen would be a dead key.

The `u` route param closes the gap. When `GangwayScreen` mounts and finds no page for its
key but a `u` param, it calls `client.rehydrate(key, url)` and shows the `rehydrating`
fallback (a spinner) until the store fills:

- Each screen in a restored stack rehydrates **independently as it mounts** — the whole
  stack self-heals, and back-nav across already-rehydrated screens is cache-only again.
- `rehydrate` writes under the **existing** key without navigating, is idempotent per key,
  and no-ops if the page is present.
- Because `u` is the page object's `url` — the *post-redirect* URL — a route created by a
  form POST rehydrates from the resource it landed on, not from the POST target.
- A 409 during rehydration stores the update-required fallback under the same key, so a
  gated screen degrades in place.

**Current limitation:** rehydration heals whatever routes the OS restored, but a *cold*
deep link opens a single route with no stack beneath it — back exits the app. The planned
fix is a server-provided stack hint; see
[issue #6](https://github.com/yuchida-tamu/gangway/issues/6) and DESIGN.md §11.

## Writing a custom adapter

The core is router-agnostic; Expo Router support is one implementation of a one-method
interface:

```ts
import type { RouterAdapter } from '@gangway/client/core'

const myAdapter: RouterAdapter = {
  apply(action, key, url) {
    // place the screen for `key` into your navigator;
    // carry `key` AND `url` in the route so GangwayScreen can look up + rehydrate.
  },
}
```

Requirements for a faithful adapter: route params must carry both `key` and `url`; `back`
must render from cache (no refetch); `resetTo` must unwind to a single root. A plain
react-navigation adapter would follow the same catch-all-screen pattern with route params
instead of URL segments. (The e2e suite's fake adapter —
`apps/server/test/e2e.ts` — records `apply` calls and is the minimal reference.)

**Known limitation:** the adapter convention currently assumes a single stack; addressing
tabs/multi-stack apps is an open design question
([issue #3](https://github.com/yuchida-tamu/gangway/issues/3)).

---

Next: [Versioning & updates](versioning.md)
