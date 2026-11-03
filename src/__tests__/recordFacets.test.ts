import { describe, it, expect } from 'vitest'
import { hasCoordinates, imagePathsOf, hasImage, countFacets } from '../utils/recordFacets'
import type { UnifiedRecord } from '../types/UnifiedRecord'

const vaBaseOnly: UnifiedRecord = { id: 'va:1', _source: 'vam', title: 'Stone Henge', date: '1820',
  vam: { iiifImageBase: 'https://framemark.vam.ac.uk/collections/2016JG8103/' } }
const vaThumb: UnifiedRecord = { id: 'va:2', _source: 'vam', title: 'Stone Henge 2',
  vam: { thumbnail: 'https://framemark.vam.ac.uk/collections/2013GE8498/full/!100,100/0/default.jpg' } }
const smgNoMedia: UnifiedRecord = { id: 'smg:1', _source: 'smg', title: 'Tumbler', smg: { accessionNumber: '1999-1' } }
const linkOnly: UnifiedRecord = { id: 'ar:1', _source: 'ariadne', title: 'Report', url: 'https://archaeologydataservice.ac.uk/archives/view/x',
  decimalLatitude: 51.18, decimalLongitude: -1.83 }
const dataUrl: UnifiedRecord = { id: 'f:1', _source: 'imageView', title: 'cap', content: 'data:image/png;base64,AAAA', contentType: 'image' }

describe('hasCoordinates', () => {
  it('is the Map predicate: both decimalLatitude and decimalLongitude non-null', () => {
    expect(hasCoordinates(linkOnly)).toBe(true)
    expect(hasCoordinates({ id: 'x', decimalLatitude: 0, decimalLongitude: 0 })).toBe(true)
    expect(hasCoordinates({ id: 'x', decimalLatitude: 51 })).toBe(false)
    expect(hasCoordinates(vaBaseOnly)).toBe(false)
  })
})

describe('imagePathsOf / hasImage', () => {
  const records = [vaBaseOnly, vaThumb, smgNoMedia, linkOnly, dataUrl]
  const paths = imagePathsOf(records)

  it('discovers image-kind paths including IIIF Image API services and data URLs, not record-page links', () => {
    expect(paths).toContain('vam.iiifImageBase')
    expect(paths).toContain('vam.thumbnail')
    expect(paths).toContain('content')
    expect(paths).not.toContain('url')
  })

  it('a record counts when any image path holds a non-empty string', () => {
    expect(hasImage(vaBaseOnly, paths)).toBe(true)
    expect(hasImage(vaThumb, paths)).toBe(true)
    expect(hasImage(dataUrl, paths)).toBe(true)
    expect(hasImage(smgNoMedia, paths)).toBe(false)
    expect(hasImage(linkOnly, paths)).toBe(false)
  })
})

describe('countFacets', () => {
  it('counts coordinates, plottable dates and images in one pass', () => {
    expect(countFacets([vaBaseOnly, vaThumb, smgNoMedia, linkOnly, dataUrl])).toEqual({ coords: 1, dates: 1, images: 3 })
    expect(countFacets([])).toEqual({ coords: 0, dates: 0, images: 0 })
  })
})
