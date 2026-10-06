import { describe, it, expect, vi, afterEach } from 'vitest'
import { urlProxyMiddleware } from '../../server/proxies.mjs'

/**
 * The simple fetch path follows redirects by hand. Each intermediate 3xx body
 * must be released (otherwise undici keeps the pooled socket busy until GC)
 * and the documented 30 s limit must apply to the whole chain, not per hop.
 */
function fakeResponse(status: number, headers: Record<string, string>, body = '') {
  const cancel = vi.fn(async () => {})
  const bytes = new TextEncoder().encode(body)
  let consumed = false
  return {
    status,
    headers: new Headers(headers),
    body: {
      cancel,
      getReader: () => ({
        read: async () => {
          if (consumed) return { done: true as const, value: undefined }
          consumed = true
          return { done: false as const, value: bytes }
        },
        cancel,
      }),
    },
    _cancel: cancel,
  }
}

function fakeRes() {
  let finish!: () => void
  const finished = new Promise<void>(r => { finish = r })
  const res = {
    statusCode: 200, headersSent: false, body: '', headers: {} as Record<string, string>,
    setHeader(k: string, v: string) { this.headers[k] = v },
    end(chunk?: string | Buffer) { this.body = chunk ? String(chunk) : ''; finish() },
    finished,
  }
  return res
}

describe('urlProxyMiddleware redirect handling', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('cancels each intermediate 3xx body and reuses one deadline across hops', async () => {
    const r302 = fakeResponse(302, { location: 'https://example.org/final' })
    const r200 = fakeResponse(200, { 'content-type': 'text/plain' }, 'done')
    const signals: AbortSignal[] = []
    const fetchSpy = vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
      signals.push(init.signal)
      return signals.length === 1 ? r302 : r200
    })
    vi.stubGlobal('fetch', fetchSpy)

    const res = fakeRes()
    urlProxyMiddleware(
      { url: '/url-proxy?url=' + encodeURIComponent('https://example.org/start') } as unknown as import('http').IncomingMessage,
      res as unknown as import('http').ServerResponse,
      () => {},
    )
    await res.finished

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('done')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(r302._cancel).toHaveBeenCalled()
    expect(signals[0]).toBe(signals[1])
  })
})
