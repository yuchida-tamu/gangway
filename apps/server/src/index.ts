/**
 * Demo BFF. Exercises every protocol path:
 *   - page objects + typed props        GET  /            /orders  /orders/:id
 *   - modal nav intent                  GET  /orders/new
 *   - form POST → 422 or 303            POST /orders
 *   - server-driven flow change         POST /orders/:id/archive (redirect w/ resetTo)
 *   - missing-component wall            GET  /labs (returns a screen no client has)
 *   - version gate (409)                GET  /vip  (requires bundle >= 2)
 */
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createGangway } from '@gangway/server'

export interface Order {
  id: number
  title: string
  amount: number
  status: 'open' | 'archived'
  createdAt: string
}

/**
 * The page map — the single source of truth for the component contract.
 * The Expo app imports this type to get typed props per screen.
 */
export type Pages = {
  Home: { greeting: string; stats: { open: number; archived: number } }
  'Orders/Index': { orders: Order[] }
  'Orders/Show': { order: Order }
  'Orders/New': { defaults: { title: string; amount: number } }
  /** Deliberately NOT registered in the demo client — exercises the fallback. */
  'Labs/Future': { secret: string }
  Vip: { message: string }
}

// In-memory store; a real app would call into its domain layer here.
const orders: Order[] = [
  { id: 1, title: 'Aluminum extrusions', amount: 1200, status: 'open', createdAt: '2026-07-01' },
  { id: 2, title: 'M5 hex bolts (x500)', amount: 89, status: 'open', createdAt: '2026-07-03' },
]
let nextId = 3

export const gangway = createGangway<Pages>({
  // The bundle version the server currently expects clients to have.
  version: '1',
  debugHtml: true,
})

export const app = new Hono()

app.get('/', (c) =>
  gangway.page(c, 'Home', {
    greeting: 'Gangway demo BFF',
    stats: {
      open: orders.filter((o) => o.status === 'open').length,
      archived: orders.filter((o) => o.status === 'archived').length,
    },
  }),
)

app.get('/orders', (c) =>
  gangway.page(c, 'Orders/Index', { orders: orders.filter((o) => o.status === 'open') }),
)

app.get('/orders/new', (c) =>
  gangway.page(c, 'Orders/New', { defaults: { title: '', amount: 0 } }, { nav: { action: 'modal' } }),
)

app.get('/orders/:id', (c) => {
  const order = orders.find((o) => o.id === Number(c.req.param('id')))
  if (!order) return c.notFound()
  return gangway.page(c, 'Orders/Show', { order })
})

app.post('/orders', async (c) => {
  const body = await c.req.json<{ title?: string; amount?: number }>().catch(() => ({}) as Record<string, never>)
  const errs: Record<string, string> = {}
  if (!body.title?.trim()) errs.title = 'Title is required.'
  if (typeof body.amount !== 'number' || body.amount <= 0) errs.amount = 'Amount must be a positive number.'
  if (Object.keys(errs).length > 0) return gangway.errors(c, errs)

  const order: Order = {
    id: nextId++,
    title: body.title!.trim(),
    amount: body.amount!,
    status: 'open',
    createdAt: new Date().toISOString().slice(0, 10),
  }
  orders.push(order)
  // Classic Inertia move: mutate, then 303 to the resulting resource.
  return gangway.redirect(c, `/orders/${order.id}`)
})

app.post('/orders/:id/archive', (c) => {
  const order = orders.find((o) => o.id === Number(c.req.param('id')))
  if (!order) return c.notFound()
  order.status = 'archived'
  return gangway.redirect(c, '/orders')
})

// The wall, on purpose: a screen the demo client does not register.
app.get('/labs', (c) => gangway.page(c, 'Labs/Future', { secret: 'you need a newer bundle to see this' }))

// Server-side version gate: only clients with bundle >= 2 may enter.
app.get('/vip', (c) => {
  const gate = gangway.requireBundle(c, '2')
  if (gate) return gate
  return gangway.page(c, 'Vip', { message: 'Welcome, up-to-date client.' })
})

const port = Number(process.env.PORT ?? 3939)
if (process.env.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port }, () => {
    console.log(`gangway demo BFF listening on http://localhost:${port}`)
  })
}
