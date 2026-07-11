[Docs](README.md) › React bindings

# React bindings — `@gangway/client`

The main `@gangway/client` entry point re-exports the [core](client-core.md) plus the React
layer: a context provider, the screen host component, four hooks, and `Link`. This layer is
in charge of **rendering page objects** — everything network- and store-related lives in
the core.

```ts
import {
  GangwayProvider, GangwayScreen, Link,
  usePage, useVisit, useForm, useAction, useGangway,
} from '@gangway/client'
```

## `GangwayProvider`

Mount once at the app root (in Expo Router: `app/_layout.tsx`, wrapping the `<Stack>`).

```tsx
<GangwayProvider client={gangway} registry={registry} fallback={Fallback}>
  {children}
</GangwayProvider>
```

| Prop | Type | Meaning |
|---|---|---|
| `client` | `GangwayClient` | The app's single client instance |
| `registry` | `ScreenRegistry` | Screen name → component map (below) |
| `fallback` | `ComponentType<FallbackProps>` | The screen rendered for every degraded state (below) |

All Gangway hooks throw if used outside the provider.

## The screen registry

```ts
type ScreenRegistry = Record<string, ComponentType<any>>

export const registry: ScreenRegistry = {
  Home,
  'Orders/Index': OrdersIndex,   // keys must match the names the BFF returns
}
```

The registry is the client's half of the component contract — **its key set defines what
this bundle can render**. When you add an entry, bump the client's `bundleVersion` and ship
an OTA update; the server may start returning the new name immediately (stale clients get
the fallback). Naming convention: `'Domain/Screen'`, matching the server's `Pages` keys
exactly.

## `GangwayScreen`

The host component that turns a stored page object into a rendered screen. You don't pass
it data — you mount it in the two catch-all routes and it resolves everything itself:

```tsx
// app/s/[key].tsx and app/m/[key].tsx
const { key, u } = useLocalSearchParams<{ key: string; u?: string }>()
return <GangwayScreen pageKey={String(key)} url={u} />
```

Resolution logic, in order:

1. **No page under `pageKey`, `url` present** → the store was lost (JS reload / OTA / cold
   start). Kick off `client.rehydrate(pageKey, url)` and render
   `<Fallback reason="rehydrating">` (a spinner state, not an error) until the store fills.
2. **No page, no `url`** → terminal `<Fallback reason="missing-page">`.
3. **Page's component is the reserved update-required name** →
   `<Fallback reason="update-required" info={...}>`.
4. **Registry lookup misses** → `<Fallback reason="missing-component" component={name}>` —
   the server named a screen this bundle doesn't have.
5. Otherwise render `<Screen {...page.props} />` inside a page context (which is what makes
   `usePage` work).

## The fallback screen

One component you provide handles every degraded state:

```ts
type FallbackReason = 'missing-component' | 'update-required' | 'missing-page' | 'rehydrating'

interface FallbackProps {
  reason: FallbackReason
  component?: string      // the screen name the server asked for (when known)
  info?: UpdateRequired   // 409 payload (minBundle, message)
  retry?: () => void      // re-attempt (currently: retry rehydration)
}
```

Design guidance: `rehydrating` should be a plain spinner; the other three are "an update is
available/needed" UX, **not** error pages — in production their button wires to
`Updates.fetchUpdateAsync()` → `Updates.reloadAsync()`. See
[Versioning](versioning.md). The demo's `apps/mobile/src/screens/Fallback.tsx` is a
complete reference implementation.

## `usePage`

Inside a screen: the current page object plus a `reload` helper. Signature:
`usePage<P>()`.

```tsx
const { props, url, version, reload } = usePage<PageProps<'Orders/Show'>>()
```

Returns the spread `PageObject` (`component`, `props` — including `errors` —, `url`,
`version`, `nav?`) and `reload()`, which re-fetches this page's URL and swaps props in
place with no navigation — wire it to pull-to-refresh. Throws outside a Gangway screen.

In practice screens rarely call `usePage` for props — props arrive as component props via
`GangwayScreen` — it exists for `reload` and for accessing `url`/`version`.

## `useVisit`

The imperative navigation primitive — for buttons, effects, and the boot screen.

```tsx
const visit = useVisit()
await visit('/orders', { intent: 'push' })                       // navigate
await visit('/logout', { method: 'POST' })                       // mutate + follow redirect
```

Returns `client.visit` bound to the context client; see
[`visit`](client-core.md#visiturl-opts) for options and the result union. Fire-and-forget
is fine for navigation; check the result when you need to react to failure.

## `useForm`

The Inertia-style form helper (`useForm<T>(initial)`) — the whole client side of a
server-validated form:

```tsx
const form = useForm({ title: '', amount: 0 })

form.data          // T — current values
form.setData(k, v) // update one field (typed)
form.errors        // Record<string, string> — set on 422, cleared on submit
form.processing    // true while a submit is in flight
form.post(url)     // submit via POST   (also: form.put / form.patch / form.delete)
```

Submit semantics: `422` → errors land in `form.errors`, the user stays put; success → the
server's `303` resolves to the next screen and navigation happens automatically — your form
component contains no success handling. Each method returns the `VisitResult` if you do
need it.

## `useAction`

In-place server actions — the escape hatch from navigation, for widgets that change server
state *within* a screen (reactions, toggles, counters):

```tsx
const { run, pending } = useAction<{ reactions: number }>()

const onPress = async () => {
  const r = await run(`/orders/${order.id}/react`)
  if (r.ok) setCount(r.data.reactions)   // update local state, animate, etc.
}
```

`run(url, data?)` POSTs and resolves to an [`ActionResult<T>`](client-core.md#actionturl-data) —
raw server JSON, no navigation, no page-store change. `pending` is true while in flight.
The server responds with [`gangway.data()`](server.md#datac-payload). If the interaction
should move the user to another screen, it's a visit/form, not an action.

## `Link`

A `Pressable` that performs a protocol visit instead of client-side routing — the BFF
decides what screen comes back:

```tsx
<Link href="/orders/1" intent="push" style={styles.row}>
  <Text>Aluminum extrusions</Text>
</Link>
```

Props: `href` (BFF URL), `intent?` (`NavAction` — the server can still override), `style?`,
`disabled?`, `prefetch?` (default `true`), `children`. Note: `Link` currently discards the visit
result — a failed visit is silent ([issue #5](https://github.com/yuchida-tamu/gangway/issues/5)).

**Perceived latency** ([issue #1](https://github.com/yuchida-tamu/gangway/issues/1)): `Link`
starts the GET on `onPressIn`, so by `onPress` the response is usually in flight or cached — a
warm cache pushes in the same frame. While a *cold* visit is still fetching the link dims
(`opacity: 0.5`) as an in-flight affordance. Pass `prefetch={false}` to opt a link out of
press-in prefetching. See [prefetch](client-core.md#prefetch--stale-while-revalidate).

## `usePrefetch()`

```tsx
const prefetch = usePrefetch()
// e.g. warm a row's target as it scrolls into view
<Order onVisible={() => prefetch(`/orders/${id}`)} />
```

Returns `(url) => void` that speculatively fetches and caches a URL's page (silent — never
navigates or surfaces errors). `Link` uses it on press-in; call it directly for viewport-based
or hover-style prefetching. Backed by [`client.prefetch`](client-core.md#prefetchurl).

## `useGangway()`

Low-level access to `{ client, registry, Fallback }` from context. For building your own
bindings (custom link components, prefetchers); app screens shouldn't need it.

---

Next: [Navigation](navigation.md)
