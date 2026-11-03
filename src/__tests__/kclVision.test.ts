import { describe, it, expect, vi, beforeEach } from 'vitest'

// Image bytes never leave the test: the shared fetch helper is stubbed so the
// content builder's RESOLUTION rules (which value, which path, which route)
// are what gets exercised.
vi.mock('../utils/imageFetch', () => ({
  fetchImageAsDataUrl: vi.fn(async (url: string) => url.startsWith('data:') ? url : `data:image/jpeg;base64,FETCHED(${url})`),
  resizeDataUrl: vi.fn(async (u: string) => u),
  IMAGE_MAX_DIM: 1280,
}))

import { buildUserContent, imagePartFor, isImagePart } from '../utils/kclVision'
import { fetchImageAsDataUrl } from '../utils/imageFetch'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('buildUserContent', () => {
  beforeEach(() => { vi.mocked(fetchImageAsDataUrl).mockClear() })

  it('returns the plain prompt when the record has no image', async () => {
    expect(await buildUserContent('Describe', { title: 'x' }, '')).toBe('Describe')
  })

  it('explicit image field: data URL passes through with its mime type', async () => {
    const out = await buildUserContent('Describe', { imageDataUrl: PNG }, 'imageDataUrl')
    expect(Array.isArray(out)).toBe(true)
    expect(out[0]).toEqual({ type: 'text', text: 'Describe' })
    expect(out[1]).toEqual({ type: 'image_url', image_url: { url: PNG, format: 'image/png' } })
  })

  it('explicit image field: a namespaced http thumbnail is fetched as a data URL', async () => {
    const rec = { title: 'T', vam: { thumbnail: 'https://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg' } }
    const out = await buildUserContent('Describe', rec, 'vam.thumbnail')
    expect(fetchImageAsDataUrl).toHaveBeenCalledWith('https://framemark.vam.ac.uk/collections/1/full/!100,100/0/default.jpg', expect.anything())
    expect((out as { type: string }[])[1].type).toBe('image_url')
  })

  it('explicit image field: an Image API service is completed before fetching', async () => {
    const rec = { vam: { iiifImageBase: 'https://framemark.vam.ac.uk/collections/2016JG8103/' } }
    await buildUserContent('Describe', rec, 'vam.iiifImageBase', { size: '!512,512' })
    expect(fetchImageAsDataUrl).toHaveBeenCalledWith('https://framemark.vam.ac.uk/collections/2016JG8103/full/!512,512/0/default.jpg', expect.anything())
  })

  it('auto-detect: contentType image → content, else the first data:image value', async () => {
    const a = await buildUserContent('P', { contentType: 'image', content: PNG, mimeType: 'image/png' }, '')
    expect(isImagePart((a as unknown[])[1])).toBe(true)
    const b = await buildUserContent('P', { foo: 'bar', shot: PNG }, '')
    expect(isImagePart((b as unknown[])[1])).toBe(true)
  })

  it('auto-detect never fetches http URLs (only explicit fields do)', async () => {
    const out = await buildUserContent('P', { vam: { thumbnail: 'https://x/a.jpg' } }, '')
    expect(out).toBe('P')
    expect(fetchImageAsDataUrl).not.toHaveBeenCalled()
  })
})

describe('imagePartFor', () => {
  it('builds one image part for any resolvable value, null otherwise', async () => {
    expect(await imagePartFor('vam.thumbnail', 'https://x/a.jpg')).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,FETCHED(https://x/a.jpg)', format: 'image/jpeg' } })
    expect(await imagePartFor('x', 'not an image')).toBeNull()
    expect(await imagePartFor('x', undefined)).toBeNull()
  })
})
