import { describe, it, expect } from 'vitest'
import {
  SOURCE_IDENTITIES, SOURCE_NAMES, SHAPE_GLYPHS, FALLBACK_COLOUR,
  sourceIdentity, sourceName, compareBySourceShape,
} from '../utils/sourceIdentity'
import { sourceName as reExportedSourceName, SOURCE_NAMES as reExportedNames } from '../utils/iiifEntries'

/** Every `_source` value written by runtime code (adapters, runners). Pinned literally. */
const RUNTIME_SOURCES = [
  'ariadne', 'europeana', 'gbif', 'hsds', 'mds', 'nhm', 'llds', 'bodleian', 'smg', 'vam',
  'sparql', 'framesense', 'imageView', 'kclField', 'ollamaField', 'merged',
]

const HEX = /^#[0-9a-f]{6}$/

describe('sourceIdentity — table integrity', () => {
  it('covers every runtime _source key', () => {
    for (const k of RUNTIME_SOURCES) expect(SOURCE_IDENTITIES[k], k).toBeDefined()
  })

  it('SOURCE_NAMES and SOURCE_IDENTITIES share the same key set', () => {
    expect(Object.keys(SOURCE_NAMES).sort()).toEqual(Object.keys(SOURCE_IDENTITIES).sort())
    for (const [k, id] of Object.entries(SOURCE_IDENTITIES)) {
      expect(id.key).toBe(k)
      expect(SOURCE_NAMES[k]).toBe(id.name)
    }
  })

  it('no two institutions share a colour, and none uses the fallback', () => {
    const colours = Object.values(SOURCE_IDENTITIES).map(i => i.colour)
    expect(new Set(colours).size).toBe(colours.length)
    expect(colours).not.toContain(FALLBACK_COLOUR)
  })

  it('every colour and banner is a 6-digit hex and every shape has a glyph', () => {
    for (const id of Object.values(SOURCE_IDENTITIES)) {
      expect(id.colour).toMatch(HEX)
      expect(id.banner).toMatch(HEX)
      expect(SHAPE_GLYPHS[id.shape]).toBeTruthy()
    }
  })
})

describe('sourceIdentity — lookup', () => {
  it('known keys return their identity', () => {
    expect(sourceIdentity('vam')).toMatchObject({ key: 'vam', name: 'V&A', shape: 'diamond' })
    expect(sourceIdentity('smg').shape).toBe('triangle')
  })

  it('unknown / missing keys fall back to a neutral circle with a readable name', () => {
    expect(sourceIdentity(undefined)).toMatchObject({ name: 'Unknown source', colour: FALLBACK_COLOUR, shape: 'circle' })
    expect(sourceIdentity('frobnicator')).toMatchObject({ name: 'Frobnicator', colour: FALLBACK_COLOUR, shape: 'circle' })
  })

  it('sourceName keeps its existing semantics and is re-exported from iiifEntries', () => {
    expect(sourceName('vam')).toBe('V&A')
    expect(sourceName(undefined)).toBe('Unknown source')
    expect(reExportedSourceName).toBe(sourceName)
    expect(reExportedNames).toBe(SOURCE_NAMES)
  })
})

describe('compareBySourceShape', () => {
  it('orders records so same-shape sources cluster, then by key', () => {
    const recs = [{ _source: 'vam' }, { _source: 'gbif' }, { _source: 'smg' }, { _source: 'ariadne' }, { _source: 'nhm' }, { _source: undefined }]
    const sorted = [...recs].sort(compareBySourceShape).map(r => r._source)
    // circle (gbif, nhm, fallback) → square → triangle (smg) → diamond (ariadne, vam)
    expect(sorted).toEqual(['gbif', 'nhm', undefined, 'smg', 'ariadne', 'vam'])
  })
})
