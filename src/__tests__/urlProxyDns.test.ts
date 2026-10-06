import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The DNS guard must consider EVERY answer for a name, not just the first:
 * a name whose records are [public, private] must be refused.
 */
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async (_host: string, opts?: { all?: boolean }) =>
    opts?.all
      ? [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]
      : { address: '93.184.216.34', family: 4 })
  return { lookup, default: { lookup } }
})

import { urlProxyMiddleware } from '../../server/proxies.mjs'

describe('urlProxyMiddleware DNS guard', () => {
  const fetchSpy = vi.fn(async () => { throw new Error('network must not be reached') })
  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('refuses a public name when any of its addresses is private', async () => {
    let finish!: () => void
    const finished = new Promise<void>(r => { finish = r })
    const res = {
      statusCode: 200, headersSent: false, body: '', headers: {} as Record<string, string>,
      setHeader(k: string, v: string) { this.headers[k] = v },
      end(chunk?: string) { this.body = String(chunk ?? ''); finish() },
    }
    urlProxyMiddleware(
      { url: '/url-proxy?url=' + encodeURIComponent('https://multi-homed.example/') } as unknown as import('http').IncomingMessage,
      res as unknown as import('http').ServerResponse,
      () => {},
    )
    await finished
    expect(res.statusCode).toBe(403)
    expect(res.body).toMatch(/private/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
