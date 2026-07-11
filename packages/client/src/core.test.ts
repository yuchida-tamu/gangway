import { describe, expect, it, vi } from 'vitest'
import { COMPONENT_UPDATE_REQUIRED, GangwayClient } from './core'
import type { PageObject } from '@gangway/protocol'

// ---- helpers --------------------------------------------------------------

/** A minimal object that behaves like a fetch Response for the client's parse. */
function res(status: number, body?: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response
}

function page(over: Partial<PageObject> = {}): PageObject {
  return {
    component: 'Home',
    props: { errors: {} },
    url: '/',
    version: '1',
    ...over,
  }
}

function makeClient(fetchImpl: typeof fetch, bundleVersion = '1') {
  const nav: Array<{ action: string; key: string; url: string }> = []
  const drifts: string[] = []
  const updates: unknown[] = []
  const client = new GangwayClient({
    baseUrl: 'http://test',
    bundleVersion,
    runtimeVersion: 'rt',
    router: { apply: (action, key, url) => nav.push({ action, key, url }) },
    fetch: fetchImpl,
    onVersionDrift: (v) => drifts.push(v),
    onUpdateRequired: (i) => updates.push(i),
  })
  return { client, nav, drifts, updates }
}

// ---- page store -----------------------------------------------------------

describe('page store', () => {
  it('sets, gets, and notifies subscribers; stops after unsubscribe', () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch)
    const p = page()
    let hits = 0
    const unsub = client.subscribe('k', () => hits++)

    expect(client.getPage('k')).toBeUndefined()
    client.setPage('k', p)
    expect(client.getPage('k')).toEqual(p)
    expect(hits).toBe(1)

    unsub()
    client.setPage('k', p)
    expect(hits).toBe(1)
  })
})

// ---- visit ----------------------------------------------------------------

describe('visit', () => {
  it('GET stores the page, pushes, and carries the page url + version headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page({ url: '/home' })))
    const { client, nav } = makeClient(fetchImpl)

    const r = await client.visit('/home')

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(nav.at(-1)).toEqual({ action: 'push', key: r.key, url: '/home' })
    expect(client.getPage(r.key)?.component).toBe('Home')

    const init = fetchImpl.mock.calls[0][1]
    expect(init.headers['X-Gangway']).toBe('1')
    expect(init.headers['X-Gangway-Bundle']).toBe('1')
    expect(init.headers['X-Gangway-Runtime']).toBe('rt')
  })

  it('mutations default to replace and send a JSON body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page({ component: 'Orders/Show', url: '/orders/3' })))
    const { client, nav } = makeClient(fetchImpl)

    await client.visit('/orders', { method: 'POST', data: { title: 'x' } })

    expect(nav.at(-1)?.action).toBe('replace')
    const init = fetchImpl.mock.calls[0][1]
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ title: 'x' })
  })

  it('server nav intent overrides the client intent', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page({ nav: { action: 'modal' } })))
    const { client, nav } = makeClient(fetchImpl)

    await client.visit('/orders/new', { intent: 'push' })

    expect(nav.at(-1)?.action).toBe('modal')
  })

  it('client intent wins when the server sends no nav', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page()))
    const { client, nav } = makeClient(fetchImpl)

    await client.visit('/', { intent: 'resetTo' })

    expect(nav.at(-1)?.action).toBe('resetTo')
  })

  it('422 returns validation errors and does not navigate', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(422, { errors: { title: 'required' } }))
    const { client, nav } = makeClient(fetchImpl)

    const r = await client.visit('/orders', { method: 'POST', data: {} })

    expect(r).toEqual({ ok: false, kind: 'validation', errors: { title: 'required' } })
    expect(nav).toHaveLength(0)
  })

  it('409 fires onUpdateRequired and navigates to a synthetic fallback page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(409, { updateRequired: true, minBundle: '2' }))
    const { client, nav, updates } = makeClient(fetchImpl)

    const r = await client.visit('/vip')

    expect(r).toMatchObject({ ok: false, kind: 'update-required', info: { minBundle: '2' } })
    expect(updates).toEqual([{ updateRequired: true, minBundle: '2' }])
    expect(nav).toHaveLength(1)
    expect(client.getPage(nav[0].key)?.component).toBe(COMPONENT_UPDATE_REQUIRED)
  })

  it('a network failure is a kind:error with status 0 and no navigation', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const { client, nav } = makeClient(fetchImpl)

    const r = await client.visit('/')

    expect(r).toMatchObject({ ok: false, kind: 'error', status: 0 })
    expect(nav).toHaveLength(0)
  })

  it('a 200 that is not a page object is a kind:error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { not: 'a page' }))
    const { client } = makeClient(fetchImpl)

    const r = await client.visit('/')

    expect(r).toMatchObject({ ok: false, kind: 'error' })
  })

  it('fires onVersionDrift when the page version differs from the bundle', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page({ version: '2' })))
    const { client, drifts } = makeClient(fetchImpl, '1')

    await client.visit('/')

    expect(drifts).toEqual(['2'])
  })

  it('mints a distinct, session-tagged key per visit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, page()))
    const { client } = makeClient(fetchImpl)

    const a = await client.visit('/')
    const b = await client.visit('/')

    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(a.key).not.toBe(b.key)
    expect(a.key).toMatch(/^g[a-z0-9]+_\d+$/)
  })
})

// ---- reload ---------------------------------------------------------------

describe('reload', () => {
  it('refetches the current page url and swaps props in place without navigating', async () => {
    const first = page({ component: 'Orders/Index', props: { orders: [1], errors: {} }, url: '/orders' })
    const second = page({ component: 'Orders/Index', props: { orders: [], errors: {} }, url: '/orders' })
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(200, first)).mockResolvedValueOnce(res(200, second))
    const { client, nav } = makeClient(fetchImpl)

    const v = await client.visit('/orders')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    const navLen = nav.length

    const r = await client.reload(v.key)

    expect(r.ok).toBe(true)
    expect(client.getPage(v.key)?.props).toEqual({ orders: [], errors: {} })
    expect(nav).toHaveLength(navLen) // no navigation
  })

  it('errors on an unknown key', async () => {
    const { client } = makeClient(vi.fn() as unknown as typeof fetch)
    const r = await client.reload('nope')
    expect(r).toMatchObject({ ok: false, kind: 'error' })
  })
})

// ---- rehydrate ------------------------------------------------------------

describe('rehydrate', () => {
  it('fills an empty store slot from the url without navigating', async () => {
    const p = page({ component: 'Orders/Show', url: '/orders/1' })
    const fetchImpl = vi.fn().mockResolvedValue(res(200, p))
    const { client, nav } = makeClient(fetchImpl)

    const r = await client.rehydrate('restored', '/orders/1')

    expect(r.ok).toBe(true)
    expect(client.getPage('restored')?.component).toBe('Orders/Show')
    expect(nav).toHaveLength(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the page already exists', async () => {
    const fetchImpl = vi.fn()
    const { client } = makeClient(fetchImpl as unknown as typeof fetch)
    client.setPage('k', page())

    const r = await client.rehydrate('k', '/x')

    expect(r.ok).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stores the update-required fallback under the key on 409, no navigation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(409, { updateRequired: true, minBundle: '2' }))
    const { client, nav, updates } = makeClient(fetchImpl)

    const r = await client.rehydrate('k', '/vip')

    expect(r).toMatchObject({ ok: false, kind: 'update-required' })
    expect(client.getPage('k')?.component).toBe(COMPONENT_UPDATE_REQUIRED)
    expect(nav).toHaveLength(0)
    expect(updates).toHaveLength(1)
  })

  it('is idempotent while in flight — concurrent calls fetch once', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const fetchImpl = vi.fn().mockImplementation(async () => {
      await gate
      return res(200, page())
    })
    const { client } = makeClient(fetchImpl as unknown as typeof fetch)

    const a = client.rehydrate('k', '/x')
    const b = client.rehydrate('k', '/x') // sees in-flight, returns early
    release()
    await Promise.all([a, b])

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

// ---- action ---------------------------------------------------------------

describe('action', () => {
  it('POSTs and returns raw JSON without navigating or storing a page', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, { reactions: 1 }))
    const { client, nav } = makeClient(fetchImpl)

    const r = await client.action<{ reactions: number }>('/orders/1/react', { x: 1 })

    expect(r).toEqual({ ok: true, data: { reactions: 1 } })
    expect(nav).toHaveLength(0)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('http://test/orders/1/react')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ x: 1 })
  })

  it('surfaces a non-ok response as an error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(500, 'boom'))
    const { client } = makeClient(fetchImpl)

    const r = await client.action('/x')

    expect(r).toMatchObject({ ok: false, status: 500 })
  })

  it('surfaces a network failure as status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
    const { client } = makeClient(fetchImpl)

    const r = await client.action('/x')

    expect(r).toMatchObject({ ok: false, status: 0 })
  })
})
