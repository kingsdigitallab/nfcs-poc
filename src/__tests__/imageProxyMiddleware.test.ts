import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Public address for every name so the DNS guard passes and the policy /
// content-type rules are what gets exercised.
vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async (_host: string, opts?: { all?: boolean }) =>
    opts?.all ? [{ address: '93.184.216.34', family: 4 }] : { address: '93.184.216.34', family: 4 })
  return { lookup, default: { lookup } }
})

import { imageProxyMiddleware } from '../../server/proxies.mjs'

function fakeRes() {
  const res = {
    statusCode: 200,
    headersSent: false,
    body: null as Buffer | string | null,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(chunk?: string | Buffer) { this.body = chunk ?? ''; this.done.resolve() },
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
  imageProxyMiddleware(req, res as unknown as import('http').ServerResponse, next)
  if (!next.mock.calls.length) await res.done.promise
  return { res, next }
}

function upstream(status: number, contentType: string, bytes: Uint8Array) {
  return {
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      cancel: async () => {},
      getReader: () => { let sent = false; return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: bytes }), cancel: async () => {} } },
    },
  }
}

describe('imageProxyMiddleware', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('passes other paths through to next()', async () => {
    const { next } = await run('/url-proxy?url=x')
    expect(next).toHaveBeenCalled()
  })

  it('refuses a host outside the built-in allowlist with 403 and never fetches', async () => {
    fetchSpy.mockImplementation(async () => { throw new Error('network must not be reached') })
    const { res } = await run('/image-proxy?url=' + encodeURIComponent('https://example.com/a.jpg'))
    expect(res.statusCode).toBe(403)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('answers 415 when the upstream is not an image', async () => {
    fetchSpy.mockResolvedValue(upstream(200, 'text/html; charset=utf-8', new TextEncoder().encode('<html>')))
    const { res } = await run('/image-proxy?url=' + encodeURIComponent('https://coimages.sciencemuseumgroup.org.uk/a.jpg'))
    expect(res.statusCode).toBe(415)
  })

  it('relays an image with CORS and cache headers', async () => {
    fetchSpy.mockResolvedValue(upstream(200, 'image/jpeg', new Uint8Array([0xff, 0xd8, 0xff])))
    const { res } = await run('/image-proxy?url=' + encodeURIComponent('https://coimages.sciencemuseumgroup.org.uk/a.jpg'))
    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('image/jpeg')
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*')
    expect(res.headers['Cache-Control']).toMatch(/max-age/)
    expect(Buffer.from(res.body as Buffer)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    // the partner hosts expect a browser UA, not the url-proxy bot string
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> }
    expect(init.headers['User-Agent']).toMatch(/Mozilla\/5\.0 \(Windows/)
  })
})
