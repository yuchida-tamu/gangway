/**
 * End-to-end protocol test: the real client core (@gangway/client/core)
 * talking to the real demo BFF over HTTP, with a fake router adapter
 * recording navigation actions. Run with: npm run test:e2e
 */
process.env.NODE_ENV = 'test'

import assert from 'node:assert/strict'
import { serve } from '@hono/node-server'
import { GangwayClient, COMPONENT_UPDATE_REQUIRED, type RouterAdapter } from '@gangway/client/core'
import type { NavAction, UpdateRequired } from '@gangway/protocol'

// Dynamic import: static imports are hoisted above the NODE_ENV assignment,
// which would let src/index auto-listen on its dev port.
const { app } = await import('../src/index')

const PORT = 4949
const server = serve({ fetch: app.fetch, port: PORT })

function makeClient(bundleVersion: string) {
  const nav: Array<{ action: NavAction; key: string }> = []
  const drifts: string[] = []
  const updates: UpdateRequired[] = []
  const router: RouterAdapter = {
    apply: (action, key) => nav.push({ action, key }),
  }
  const client = new GangwayClient({
    baseUrl: `http://localhost:${PORT}`,
    bundleVersion,
    runtimeVersion: 'exposdk:53.0.0',
    router,
    onVersionDrift: (v) => drifts.push(v),
    onUpdateRequired: (i) => updates.push(i),
  })
  return { client, nav, drifts, updates }
}

async function main() {
  const { client, nav, drifts, updates } = makeClient('1')

  // 1. Initial boot: visit '/' with replace intent.
  const home = await client.visit('/', { intent: 'replace' })
  assert(home.ok, 'home visit should succeed')
  assert.equal(home.page.component, 'Home')
  assert.equal((home.page.props as any).stats.open, 2)
  assert.deepEqual(nav.at(-1), { action: 'replace', key: home.key })

  // 2. Link visit: defaults to push.
  const index = await client.visit('/orders')
  assert(index.ok)
  assert.equal(index.page.component, 'Orders/Index')
  assert.equal((index.page.props as any).orders.length, 2)
  assert.equal(nav.at(-1)!.action, 'push')

  // 3. Server nav override: /orders/new declares modal presentation.
  const form = await client.visit('/orders/new')
  assert(form.ok)
  assert.equal(nav.at(-1)!.action, 'modal', 'server nav intent should override client default')

  // 4. Form POST with bad data → 422, stay put (no nav entry added).
  const navCountBefore = nav.length
  const bad = await client.visit('/orders', { method: 'POST', data: { title: '', amount: 0 } })
  assert(!bad.ok && bad.kind === 'validation')
  assert.equal(bad.errors.title, 'Title is required.')
  assert.equal(bad.errors.amount, 'Amount must be a positive number.')
  assert.equal(nav.length, navCountBefore, '422 must not navigate')

  // 5. Valid POST → 303 followed transparently → Orders/Show page object,
  //    with mutation default intent `replace`.
  const created = await client.visit('/orders', {
    method: 'POST',
    data: { title: 'Steel plate 3mm', amount: 480 },
  })
  assert(created.ok, 'valid POST should resolve to the redirect target page')
  assert.equal(created.page.component, 'Orders/Show')
  assert.equal((created.page.props as any).order.title, 'Steel plate 3mm')
  assert.equal(created.page.url, `/orders/${(created.page.props as any).order.id}`)
  assert.equal(nav.at(-1)!.action, 'replace')

  // 6. Back-navigation uses the cache: the earlier Orders/Index page object
  //    is still in the store, untouched — no refetch needed to go back.
  const cached = client.getPage(index.key)
  assert(cached, 'previous page object must remain cached for back-nav')
  assert.equal(cached.component, 'Orders/Index')

  // 7. reload(): archive an order server-side, then refresh the cached
  //    index page in place — pull-to-refresh semantics.
  await client.visit(`/orders/1/archive`, { method: 'POST' })
  const reloaded = await client.reload(index.key)
  assert(reloaded.ok)
  const titles = (client.getPage(index.key)!.props as any).orders.map((o: any) => o.title)
  assert(!titles.includes('Aluminum extrusions'), 'archived order should be gone after reload')

  // 8. Wall #2a (client-side): server names a screen this bundle lacks.
  //    Core still resolves — the registry miss is handled at render time.
  const labs = await client.visit('/labs')
  assert(labs.ok)
  assert.equal(labs.page.component, 'Labs/Future')

  // 9. Wall #2b (server-side gate): bundle '1' < required '2' → 409,
  //    onUpdateRequired fires, synthetic fallback page is navigated to.
  const vip = await client.visit('/vip')
  assert(!vip.ok && vip.kind === 'update-required')
  assert.equal(vip.info.minBundle, '2')
  assert.equal(updates.length, 1)
  const fallbackPage = client.getPage(nav.at(-1)!.key)!
  assert.equal(fallbackPage.component, COMPONENT_UPDATE_REQUIRED)

  // 10. An up-to-date client (bundle '2') passes the gate but sees version
  //     drift (server expects '1'... i.e. drift detection is symmetric).
  const fresh = makeClient('2')
  const vipOk = await fresh.client.visit('/vip')
  assert(vipOk.ok)
  assert.equal(vipOk.page.component, 'Vip')
  assert.equal(fresh.drifts.length, 1, 'version drift callback should fire when bundle != server version')

  console.log('✔ all 10 protocol scenarios passed')
  server.close()
}

main().catch((e) => {
  console.error(e)
  server.close()
  process.exit(1)
})
