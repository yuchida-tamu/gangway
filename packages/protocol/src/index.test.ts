import { describe, expect, it } from 'vitest'
import {
  HEADER_BUNDLE,
  HEADER_GANGWAY,
  HEADER_RUNTIME,
  PROTOCOL_VERSION,
  isPageObject,
  isUpdateRequired,
  type PageObject,
} from './index'

describe('isPageObject', () => {
  const valid: PageObject = {
    component: 'Orders/Show',
    props: { errors: {} },
    url: '/orders/1',
    version: '1',
  }

  it('accepts a well-formed page object', () => {
    expect(isPageObject(valid)).toBe(true)
    expect(isPageObject({ ...valid, nav: { action: 'push' } })).toBe(true)
  })

  it('rejects objects missing required string fields', () => {
    expect(isPageObject({ ...valid, component: 123 })).toBe(false)
    expect(isPageObject({ ...valid, url: undefined })).toBe(false)
    expect(isPageObject({ component: 'X', url: '/x' })).toBe(false) // no props
  })

  it('rejects non-objects', () => {
    expect(isPageObject(null)).toBe(false)
    expect(isPageObject(undefined)).toBe(false)
    expect(isPageObject('string')).toBe(false)
    expect(isPageObject(42)).toBe(false)
  })

  it('rejects an update-required body (not a page)', () => {
    expect(isPageObject({ updateRequired: true, minBundle: '2' })).toBe(false)
  })
})

describe('isUpdateRequired', () => {
  it('accepts only when updateRequired === true', () => {
    expect(isUpdateRequired({ updateRequired: true, minBundle: '2' })).toBe(true)
    expect(isUpdateRequired({ updateRequired: false })).toBe(false)
    expect(isUpdateRequired({ minBundle: '2' })).toBe(false)
    expect(isUpdateRequired(null)).toBe(false)
    expect(isUpdateRequired('nope')).toBe(false)
  })
})

describe('protocol constants', () => {
  it('are the stable header names / version the client and server agree on', () => {
    expect(HEADER_GANGWAY).toBe('X-Gangway')
    expect(HEADER_RUNTIME).toBe('X-Gangway-Runtime')
    expect(HEADER_BUNDLE).toBe('X-Gangway-Bundle')
    expect(PROTOCOL_VERSION).toBe('1')
  })
})
