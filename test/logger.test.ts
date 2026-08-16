import { describe, it, expect, vi, afterEach } from 'vitest'
import { createLogger } from '../src/logger.js'

describe('createLogger', () => {
  afterEach(() => vi.restoreAllMocks())

  it('suppresses levels below threshold', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const log = createLogger('warn')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('emits structured JSON with fields merged in', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const log = createLogger('info')
    log.info('request done', { tool: 'get_current_user', status: 200 })
    const firstCall = spy.mock.calls[0]
    if (!firstCall) throw new Error('expected console.log to have been called')
    const line = JSON.parse(firstCall[0] as string) as {
      msg: string
      tool: string
      status: number
      level: string
      timestamp: string
    }
    expect(line.msg).toBe('request done')
    expect(line.tool).toBe('get_current_user')
    expect(line.status).toBe(200)
    expect(line.level).toBe('info')
    expect(typeof line.timestamp).toBe('string')
  })
})
