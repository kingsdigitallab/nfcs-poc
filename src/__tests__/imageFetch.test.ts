import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchImageAsDataUrl, blobToDataUrl, fetchIiifRegion, iiifRegionParam } from '../utils/imageFetch'

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

describe('iiifRegionParam', () => {
  it('renders a fractional box as a pct: region with one decimal, and full when omitted', () => {
    expect(iiifRegionParam({ x: 0.1, y: 0.25, w: 0.4, h: 0.333 })).toBe('pct:10.0,25.0,40.0,33.3')
    expect(iiifRegionParam(undefined)).toBe('full')
  })
})

// SMG's zoom.* server answers 403 to most explicit sizes (!600,600, !1024,1024, …)
// but serves /max/ — gotcha 33. The region fetch must fall back, not fail.
describe('fetchIiifRegion', () => {
  const fetchSpy = vi.fn()
  const SVC = 'https://zoom.sciencemuseumgroup.org.uk/iiif/3/x.ptif'
  const box = { x: 0.1, y: 0.1, w: 0.4, h: 0.4 }
  beforeEach(() => { vi.stubGlobal('fetch', fetchSpy); fetchSpy.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('requests the constrained size first and stops there when it succeeds', async () => {
    fetchSpy.mockResolvedValueOnce(okImage())
    const out = await fetchIiifRegion(SVC, { region: box, maxDim: 0 })
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe(`${SVC}/pct:10.0,10.0,40.0,40.0/!1024,1024/0/default.jpg`)
  })

  it('falls back to /max/ when the sized request is refused (direct and via proxy)', async () => {
    fetchSpy.mockResolvedValueOnce(notOk(403, 'Forbidden'))   // sized, direct
    fetchSpy.mockResolvedValueOnce(notOk(403, 'Forbidden'))   // sized, /image-proxy
    fetchSpy.mockResolvedValueOnce(okImage())                 // max, direct
    const out = await fetchIiifRegion(SVC, { region: box, maxDim: 0 })
    expect(out).toMatch(/^data:image\/png;base64,/)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
    expect(fetchSpy.mock.calls[2][0]).toBe(`${SVC}/pct:10.0,10.0,40.0,40.0/max/0/default.jpg`)
  })

  it('names both attempts when the fallback fails too', async () => {
    fetchSpy.mockResolvedValue(notOk(403, 'Forbidden'))
    await expect(fetchIiifRegion(SVC, { region: box, maxDim: 0 }))
      .rejects.toThrow(/sized !1024,1024 → HTTP 403.*max → HTTP 403/)
  })

  it('uses the full region when no box is given', async () => {
    fetchSpy.mockResolvedValueOnce(okImage())
    await fetchIiifRegion(SVC, { maxDim: 0 })
    expect(fetchSpy.mock.calls[0][0]).toBe(`${SVC}/full/!1024,1024/0/default.jpg`)
  })
})
