import { describe, it, expect } from 'vitest'
import { isOriginAllowed, corsHeaders } from '../src/http-guards.js'

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

describe('corsHeaders', () => {
  it('returns no headers when Origin is absent', () => {
    expect(corsHeaders(new Headers(), ['https://allowed.example'])).toEqual({})
  })

  it('returns no headers when Origin is absent from the allowlist', () => {
    const headers = new Headers({ origin: 'https://evil.example' })
    expect(corsHeaders(headers, ['https://allowed.example'])).toEqual({})
  })

  it('echoes an allowed Origin back with Access-Control-Allow-Origin', () => {
    const headers = new Headers({ origin: 'https://allowed.example' })
    expect(corsHeaders(headers, ['https://allowed.example'])).toEqual({
      'Access-Control-Allow-Origin': 'https://allowed.example',
      Vary: 'Origin',
    })
  })
})
