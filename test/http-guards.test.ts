import { describe, it, expect } from 'vitest'
import { isAuthorized, isOriginAllowed } from '../src/http-guards.js'

describe('isAuthorized', () => {
  it('accepts the exact configured Bearer token', () => {
    const headers = new Headers({ authorization: 'Bearer secret' })
    expect(isAuthorized(headers, 'secret')).toBe(true)
  })

  it('rejects a missing Authorization header', () => {
    expect(isAuthorized(new Headers(), 'secret')).toBe(false)
  })

  it('rejects a wrong token', () => {
    const headers = new Headers({ authorization: 'Bearer wrong' })
    expect(isAuthorized(headers, 'secret')).toBe(false)
  })
})

describe('isOriginAllowed', () => {
  it('allows a request with no Origin header', () => {
    expect(isOriginAllowed(new Headers(), [])).toBe(true)
  })

  it('allows an Origin present in the allowlist', () => {
    const headers = new Headers({ origin: 'https://allowed.example' })
    expect(isOriginAllowed(headers, ['https://allowed.example'])).toBe(true)
  })

  it('rejects an Origin absent from the allowlist', () => {
    const headers = new Headers({ origin: 'https://evil.example' })
    expect(isOriginAllowed(headers, ['https://allowed.example'])).toBe(false)
  })

  it('rejects any Origin when the allowlist is empty', () => {
    const headers = new Headers({ origin: 'https://allowed.example' })
    expect(isOriginAllowed(headers, [])).toBe(false)
  })
})
