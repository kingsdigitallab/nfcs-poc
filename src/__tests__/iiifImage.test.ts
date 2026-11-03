import { describe, it, expect } from 'vitest'
import {
  IIIF_SERVICE_KEYS,
  imageServiceBase,
  isImageServiceRef,
  imageServiceUrl,
  resolveImageSrc,
  extractServiceBase,
  iiifSizeParam,
  iiifSizeLabel,
} from '../utils/iiifImage'

const VAM_BASE  = 'https://framemark.vam.ac.uk/collections/2016JG8103/'
const VAM_THUMB = 'https://framemark.vam.ac.uk/collections/2016JG8103/full/!100,100/0/default.jpg'
const NHM_INFO  = 'https://data.nhm.ac.uk/media/5b3f91d5-6cf6-4f8b-8b60-75191cd67af4/info.json'

describe('imageServiceBase', () => {
  it('strips a trailing slash (V&A iiifImageBase)', () => {
    expect(imageServiceBase(VAM_BASE)).toBe('https://framemark.vam.ac.uk/collections/2016JG8103')
  })
  it('strips /info.json (NHM iiifInfo)', () => {
    expect(imageServiceBase(NHM_INFO)).toBe('https://data.nhm.ac.uk/media/5b3f91d5-6cf6-4f8b-8b60-75191cd67af4')
  })
  it('strips a /full/… image request back to the service', () => {
    expect(imageServiceBase(VAM_THUMB)).toBe('https://framemark.vam.ac.uk/collections/2016JG8103')
  })
  it('is idempotent', () => {
    const once = imageServiceBase(VAM_BASE)
    expect(imageServiceBase(once)).toBe(once)
  })
})

describe('imageServiceUrl', () => {
  it('builds an Image API request with no double slash', () => {
    expect(imageServiceUrl(VAM_BASE)).toBe('https://framemark.vam.ac.uk/collections/2016JG8103/full/!1200,1200/0/default.jpg')
    expect(imageServiceUrl(VAM_BASE, 'max')).toBe('https://framemark.vam.ac.uk/collections/2016JG8103/full/max/0/default.jpg')
  })
})

describe('isImageServiceRef', () => {
  it('recognises the service-ish keys by their last path segment', () => {
    expect(IIIF_SERVICE_KEYS.test('iiifImageBase')).toBe(true)
    expect(isImageServiceRef('vam.iiifImageBase', VAM_BASE)).toBe(true)
    expect(isImageServiceRef('nhm.iiifInfo', NHM_INFO)).toBe(true)
  })
  it('recognises an info.json value under any key', () => {
    expect(isImageServiceRef('somewhere.else', NHM_INFO)).toBe(true)
  })
  it('does not treat a finished image URL or a manifest as a service', () => {
    expect(isImageServiceRef('vam.thumbnail', VAM_THUMB)).toBe(false)
    expect(isImageServiceRef('vam.manifest', 'https://iiif.vam.ac.uk/collections/O1041792/manifest.json')).toBe(false)
    expect(isImageServiceRef('vam.iiifImageBase', undefined)).toBe(false)
  })
})

describe('resolveImageSrc', () => {
  it('turns a service reference into a displayable image request', () => {
    expect(resolveImageSrc('vam.iiifImageBase', VAM_BASE))
      .toBe('https://framemark.vam.ac.uk/collections/2016JG8103/full/!1200,1200/0/default.jpg')
    expect(resolveImageSrc('nhm.iiifInfo', NHM_INFO))
      .toBe('https://data.nhm.ac.uk/media/5b3f91d5-6cf6-4f8b-8b60-75191cd67af4/full/!1200,1200/0/default.jpg')
  })
  it('honours a requested size', () => {
    expect(resolveImageSrc('vam.iiifImageBase', VAM_BASE, '!512,512')).toMatch(/\/full\/!512,512\/0\/default\.jpg$/)
  })
  it('passes finished image URLs and data URLs through unchanged', () => {
    expect(resolveImageSrc('vam.thumbnail', VAM_THUMB)).toBe(VAM_THUMB)
    const eu = 'https://api.europeana.eu/thumbnail/v2/url.json?uri=x&type=IMAGE'
    expect(resolveImageSrc('europeana.thumbnail', eu)).toBe(eu)
    expect(resolveImageSrc('content', 'data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA')
  })
  it('returns null for empty, non-string or non-URL values', () => {
    expect(resolveImageSrc('x', undefined)).toBeNull()
    expect(resolveImageSrc('x', '')).toBeNull()
    expect(resolveImageSrc('x', 42)).toBeNull()
    expect(resolveImageSrc('x', 'not a url')).toBeNull()
  })
})

describe('moved helpers keep their behaviour', () => {
  it('extractServiceBase handles string, object and array forms', () => {
    expect(extractServiceBase('https://x/iiif/2/abc/info.json')).toBe('https://x/iiif/2/abc')
    expect(extractServiceBase({ '@id': 'https://x/iiif/2/abc/full/max/0/default.jpg' })).toBe('https://x/iiif/2/abc')
    expect(extractServiceBase([null, { id: 'https://x/iiif/2/abc' }])).toBe('https://x/iiif/2/abc')
    expect(extractServiceBase(null)).toBeNull()
  })
  it('iiifSizeParam tiers by zoom and iiifSizeLabel describes the tier', () => {
    expect(iiifSizeParam(0.5)).toBe('!600,600')
    expect(iiifSizeParam(1)).toBe('!1200,1200')
    expect(iiifSizeParam(2)).toBe('!2400,2400')
    expect(iiifSizeParam(4)).toBe('max')
    expect(iiifSizeLabel('max')).toBe('Full resolution')
    expect(iiifSizeLabel('!600,600')).toBe('≤ 600 px (constrained)')
  })
})
