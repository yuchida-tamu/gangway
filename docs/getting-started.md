[Docs](README.md) › Getting started

# Getting started

This walkthrough builds the smallest useful Gangway pair: a Hono BFF with two screens and a
form, and an Expo app that renders them. It mirrors the demo apps in this repo
(`apps/server`, `apps/mobile`) — when in doubt, read those; they exercise every protocol
path.

> Gangway is not published to npm yet. Use it the way the demo does: as workspace packages
> inside this monorepo (`"@gangway/server": "*"` etc. in your `package.json`, with npm
> workspaces resolving them). The packages ship raw TypeScript (`main: ./src/index.ts`),
> which Metro and `tsx` both consume directly.

## 1. The BFF

Install the peer dependency (`hono`) and define your **page map** — the single source of
truth for what each screen receives — then write ordinary routes:

```ts
// server/src/index.ts
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createGangway } from '@gangway/server'

export interface Order {
  id: number
  title: string
  status: 'open' | 'archived'
}

/** The component contract: screen name → props. Export it for the app. */
export type Pages = {
  Home: { greeting: string }
  'Orders/Index': { orders: Order[] }
  'Orders/Show': { order: Order }
  'Orders/New': { defaults: { title: string } }
}

const gangway = createGangway<Pages>({
  version: '1',      // the client-bundle version this server expects
  debugHtml: true,   // browsers get an inspectable view of page objects
})

const app = new Hono()

app.get('/', (c) => gangway.page(c, 'Home', { greeting: 'hello' }))

app.get('/orders', (c) => gangway.page(c, 'Orders/Index', { orders }))

app.get('/orders/new', (c) =>
  gangway.page(c, 'Orders/New', { defaults: { title: '' } }, { nav: { action: 'modal' } }))

app.get('/orders/:id', (c) => {
  const order = orders.find((o) => o.id === Number(c.req.param('id')))
  if (!order) return c.notFound()
  return gangway.page(c, 'Orders/Show', { order })
})

app.post('/orders', async (c) => {
  const body = await c.req.json<{ title?: string }>()
  if (!body.title?.trim()) return gangway.errors(c, { title: 'Title is required.' })
  const order = createOrder(body.title)
  return gangway.redirect(c, `/orders/${order.id}`)   // 303 → client lands on the new order
})

serve({ fetch: app.fetch, port: 3939 })
```

That's the whole server story: `page` for screens, `redirect` after successful mutations,
`errors` for validation failures. Full reference: [Server API](server.md).

## 2. The Expo app

### 2.1 One client instance

```ts
// app-src/gangway.ts
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { GangwayClient, createExpoRouterAdapter } from '@gangway/client'
import type { Errors } from '@gangway/protocol'
import type { Pages } from '@my/server'   // TYPE-ONLY import — see below

/** Typed props for a screen, derived from the BFF's page map. */
export type PageProps<K extends keyof Pages> = Pages[K] & { errors: Errors }

export const BUNDLE_VERSION = '1'   // bump when screens are added, then `eas update`

export const gangway = new GangwayClient({
  baseUrl: process.env.EXPO_PUBLIC_BFF_URL ??
    Platform.select({ android: 'http://10.0.2.2:3939', default: 'http://localhost:3939' }),
  bundleVersion: BUNDLE_VERSION,
  runtimeVersion: Constants.expoConfig?.runtimeVersion?.toString() ?? 'dev',
  router: createExpoRouterAdapter(),
})
```

The `Pages` import **must stay type-only** (a tsconfig path alias pointing at the server
workspace). Types are erased at build time, so Metro never bundles server code — but every
screen is typechecked against its controller. Never import server *values* into the app.

### 2.2 The registry and the fallback

```tsx
// app-src/registry.tsx — the client's half of the component contract
import type { ScreenRegistry } from '@gangway/client'
export const registry: ScreenRegistry = {
  Home,
  'Orders/Index': OrdersIndex,
  'Orders/Show': OrdersShow,
  'Orders/New': OrdersNew,   // keys must match the names the BFF returns
}
```

You must also provide a **fallback screen** — rendered when the server names a screen this
bundle lacks, when an update is required, or while a lost page re-fetches. Copy
`apps/mobile/src/screens/Fallback.tsx` as a starting point; the required props are
documented in [React bindings](react.md#the-fallback-screen).

### 2.3 Layout and the two catch-all routes

Gangway's Expo Router convention is two routes that both render `<GangwayScreen/>`: one
card-presented, one modal-presented.

```tsx
// app/_layout.tsx
export default function RootLayout() {
  return (
    <GangwayProvider client={gangway} registry={registry} fallback={Fallback}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="s/[key]" />
        <Stack.Screen name="m/[key]" options={{ presentation: 'modal' }} />
      </Stack>
    </GangwayProvider>
  )
}
```

```tsx
// app/s/[key].tsx  (app/m/[key].tsx is identical)
import { useLocalSearchParams } from 'expo-router'
import { GangwayScreen } from '@gangway/client'

export default function StackScreen() {
  const { key, u } = useLocalSearchParams<{ key: string; u?: string }>()
  return <GangwayScreen pageKey={String(key)} url={u} />
}
```

```tsx
// app/index.tsx — the boot screen: the BFF decides what the first screen is
export default function Boot() {
  const visit = useVisit()
  useEffect(() => { visit('/', { intent: 'replace' }) }, [visit])
  return <ActivityIndicator />
}
```

### 2.4 Screens are just components

```tsx
// app-src/screens/OrdersIndex.tsx
import { Link } from '@gangway/client'
import type { PageProps } from '../gangway'

export default function OrdersIndex({ orders }: PageProps<'Orders/Index'>) {
  return (
    <>
      {orders.map((o) => (
        <Link key={o.id} href={`/orders/${o.id}`}><Text>{o.title}</Text></Link>
      ))}
      <Link href="/orders/new"><Text>New order</Text></Link>
    </>
  )
}
```

Note there is no data fetching, no loading state, no route params — props arrive from the
controller, fully formed.

### 2.5 A form

```tsx
// app-src/screens/OrdersNew.tsx
export default function OrdersNew({ defaults }: PageProps<'Orders/New'>) {
  const form = useForm({ title: defaults.title })
  return (
    <>
      <TextInput value={form.data.title} onChangeText={(t) => form.setData('title', t)} />
      {form.errors.title && <Text>{form.errors.title}</Text>}
      <Button disabled={form.processing} onPress={() => form.post('/orders')} title="Create" />
    </>
  )
}
```

Submit with bad data → the server's `422` lands in `form.errors` and the user stays put.
Submit with good data → the server's `303` resolves to `Orders/Show` and navigation happens
automatically. The form component contains **no** success/redirect handling.

## 3. Run it

```sh
npm run dev:server    # BFF on :3939 — open it in a browser for the debug HTML view
npm run dev:mobile    # Expo dev server; press i for the iOS simulator
```

## 4. Where to go next

- [Concepts & architecture](concepts.md) — the mental model behind what you just wired.
- [Navigation](navigation.md) — nav intents, modals, `resetTo`, and how rehydration
  self-heals a restored stack after a JS reload.
- [Versioning & updates](versioning.md) — what happens when the server names a screen this
  bundle doesn't have, and how to wire `expo-updates`.
