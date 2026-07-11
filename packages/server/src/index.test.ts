import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { HEADER_GANGWAY, HEADER_UPDATE_REQUIRED } from '@gangway/protocol'
import { createGangway } from './index'

type Pages = {
  Home: { greeting: string }
  'Orders/Show': { id: number }
}

function makeApp(debugHtml = false) {
  const g = createGangway<Pages>({ version: '1', debugHtml })
  const app = new Hono()
  app.get('/', (c) => g.page(c, 'Home', { greeting: 'hi' }))
  app.get('/orders/:id', (c) => g.page(c, 'Orders/Show', { id: Number(c.req.param('id')) }))
  app.get('/modal', (c) => g.page(c, 'Home', { greeting: 'm' }, { nav: { action: 'modal' } }))
  app.post('/mutate', (c) => g.redirect(c, '/'))
  app.post('/bad', (c) => g.errors(c, { title: 'required' }))
  app.get('/vip', (c) => g.requireBundle(c, '2') ?? g.page(c, 'Home', { greeting: 'vip' }))
  app.post('/react', (c) => g.data(c, { reactions: 5 }))
  return app
}

const app = makeApp()
const HDR = { [HEADER_GANGWAY]: '1', 'X-Gangway-Bundle': '1' }

describe('page()', () => {
  it('returns a page object with an errors bag, version, and the gangway header', async () => {
    const r = await app.request('/', { headers: HDR })
    expect(r.status).toBe(200)
    expect(r.headers.get(HEADER_GANGWAY)).toBe('1')
    expect(await r.json()).toEqual({
      component: 'Home',
      props: { greeting: 'hi', errors: {} },
      url: '/',
      version: '1',
    })
  })

  it('reflects the request path in url and passes typed props', async () => {
    const body = await (await app.request('/orders/7', { headers: HDR })).json()
    expect(body.url).toBe('/orders/7')
    expect(body.props.id).toBe(7)
  })

  it('carries a server nav intent when given', async () => {
    const body = await (await app.request('/modal', { headers: HDR })).json()
    expect(body.nav).toEqual({ action: 'modal' })
  })

  it('renders debug HTML for a non-gangway request when debugHtml is on', async () => {
    const r = await makeApp(true).request('/') // no X-Gangway header
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(await r.text()).toContain('Home')
  })
})

describe('redirect()', () => {
  it('is a 303 to the target', async () => {
    const r = await app.request('/mutate', { method: 'POST', headers: HDR })
    expect(r.status).toBe(303)
    expect(r.headers.get('Location')).toBe('/')
  })
})

describe('errors()', () => {
  it('is a 422 carrying the error bag', async () => {
    const r = await app.request('/bad', { method: 'POST', headers: HDR })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ errors: { title: 'required' } })
  })
})

describe('requireBundle()', () => {
  it('409s a stale client with the min-bundle header + body', async () => {
    const r = await app.request('/vip', { headers: { [HEADER_GANGWAY]: '1', 'X-Gangway-Bundle': '1' } })
    expect(r.status).toBe(409)
    expect(r.headers.get(HEADER_UPDATE_REQUIRED)).toBe('2')
    expect(await r.json()).toMatchObject({ updateRequired: true, minBundle: '2' })
  })

  it('passes a client whose bundle is at or above the minimum', async () => {
    const r = await app.request('/vip', { headers: { [HEADER_GANGWAY]: '1', 'X-Gangway-Bundle': '2' } })
    expect(r.status).toBe(200)
    expect((await r.json()).props.greeting).toBe('vip')
  })
})

describe('data()', () => {
  it('returns raw JSON (no page object) with the gangway header', async () => {
    const r = await app.request('/react', { method: 'POST', headers: HDR })
    expect(r.status).toBe(200)
    expect(r.headers.get(HEADER_GANGWAY)).toBe('1')
    expect(await r.json()).toEqual({ reactions: 5 })
  })
})
