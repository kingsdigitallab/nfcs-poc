import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { urlProxyMiddleware } from '../../server/proxies.mjs'

/**
 * Middleware-level guard for /url-proxy. Network is stubbed: a denied
 * target must be rejected BEFORE fetch is ever called.
 */
function fakeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: '',
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(chunk?: string | Buffer) { this.body = chunk ? String(chunk) : ''; this.done.resolve() },
    done: (() => {
      let resolve!: () => void
      const promise = new Promise<void>(r => { resolve = r })
      return { promise, resolve }
    })(),
  }
  return res
}

async function run(url: string) {
  const req = { url } as unknown as import('http').IncomingMessage
  const res = fakeRes()
  const next = vi.fn()
  urlProxyMiddleware(req, res as unknown as import('http').ServerResponse, next)
  await res.done.promise
  return { res, next }
}

describe('urlProxyMiddleware policy enforcement', () => {
  const fetchSpy = vi.fn(async () => { throw new Error('network must not be reached') })
  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockClear() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('rejects a private target with 403 without touching the network', async () => {
    const { res } = await run('/url-proxy?url=' + encodeURIComponent('http://10.0.0.1/secret'))
    expect(res.statusCode).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects the cloud metadata address with 403', async () => {
    const { res } = await run('/url-proxy?url=' + encodeURIComponent('http://169.254.169.254/latest/meta-data'))
    expect(res.statusCode).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects an unknown wait strategy with 400', async () => {
    const { res } = await run('/url-proxy?url=' + encodeURIComponent('https://example.org/') + '&js=true&wait=bogus')
    expect(res.statusCode).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still rejects a non-http scheme with 400', async () => {
    const { res } = await run('/url-proxy?url=' + encodeURIComponent('ftp://example.org/'))
    expect(res.statusCode).toBe(400)
  })
})
