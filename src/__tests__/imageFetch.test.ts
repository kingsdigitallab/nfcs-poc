import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchImageAsDataUrl, blobToDataUrl } from '../utils/imageFetch'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const okImage = () => ({ ok: true, status: 200, blob: async () => new Blob([PNG], { type: 'image/png' }) })
const notOk   = (status: number, text = '') => ({ ok: false, status, blob: async () => new Blob([]), text: async () => text })

describe('fetchImageAsDataUrl', () => {
  const fetchSpy = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns a data URL untouched without any fetch', async () => {
    const out = await fetchImageAsDataUrl('data:image/png;base64,iVBORw0KGgo=', { maxDim: 0 })
    expect(out).toBe('data:image/png;base64,iVBORw0KGgo=')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches directly when the host allows CORS', async () => {
    fetchSpy.mockResolvedValueOnce(okImage())
    const out = await fetchImageAsDataUrl('https://framemark.vam.ac.uk/x.jpg', { maxDim: 0 })
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://framemark.vam.ac.uk/x.jpg')
  })

  it('falls back to /image-proxy once when the direct fetch fails (CORS / network)', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fetchSpy.mockResolvedValueOnce(okImage())
    const out = await fetchImageAsDataUrl('https://coimages.sciencemuseumgroup.org.uk/a.jpg', { maxDim: 0 })
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[1][0]).toBe('/image-proxy?url=' + encodeURIComponent('https://coimages.sciencemuseumgroup.org.uk/a.jpg'))
  })

  it('surfaces the proxy refusal text when both routes fail', async () => {
    fetchSpy.mockResolvedValueOnce(notOk(403))
    fetchSpy.mockResolvedValueOnce(notOk(415, 'Proxy error: upstream is not an image'))
    await expect(fetchImageAsDataUrl('https://example.com/page', { maxDim: 0 }))
      .rejects.toThrow(/not an image/)
  })

  it('blobToDataUrl encodes the blob with its mime type', async () => {
    expect(await blobToDataUrl(new Blob([PNG], { type: 'image/png' }))).toBe('data:image/png;base64,iVBORw==')
  })
})
