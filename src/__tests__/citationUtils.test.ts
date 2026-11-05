import { describe, it, expect } from 'vitest'
import { citableRecords, citationFingerprint, type RecordCitation } from '../utils/citationUtils'

const cite = (recordId: string, extra: Partial<RecordCitation> = {}): RecordCitation => ({
  service: 'GBIF', serviceUrl: 'https://www.gbif.org', accessDate: '2026-11-05T10:00:00.000Z', recordId, ...extra,
})

describe('citableRecords', () => {
  it('keeps only records whose _citation is a plain object', () => {
    const recs = [
      { id: 'a', _citation: cite('a') },
      { id: 'b' },
      { id: 'c', _citation: null },
      { id: 'd', _citation: [cite('d')] },
      { id: 'e', _citation: 'GBIF' },
    ]
    expect(citableRecords(recs).map(r => r.id)).toEqual(['a'])
    expect(citableRecords([])).toEqual([])
  })
})

describe('citationFingerprint', () => {
  const recs = () => [{ id: 'a', _citation: cite('a') }, { id: 'b', _citation: cite('b') }, { id: 'c', _citation: cite('c') }]

  it('is stable across two array copies with the same ids (the hook rebuilds the array every render)', () => {
    expect(citationFingerprint(recs())).toBe(citationFingerprint(recs()))
  })

  it('changes when the length or an end record changes', () => {
    const base = citationFingerprint(recs())
    expect(citationFingerprint(recs().slice(0, 2))).not.toBe(base)
    expect(citationFingerprint([...recs().slice(0, 2), { id: 'z', _citation: cite('z') }])).not.toBe(base)
    expect(citationFingerprint([{ id: 'y', _citation: cite('y') }, ...recs().slice(1)])).not.toBe(base)
  })

  it('handles an empty set', () => {
    expect(citationFingerprint([])).toBe('0::')
  })
})
