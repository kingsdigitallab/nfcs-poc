import { describe, it, expect } from 'vitest'
import { citableRecords, citationFingerprint, formatRecordCitation, formatRecordCitationParts, formatAllCitations, CITATION_STYLES, type RecordCitation } from '../utils/citationUtils'

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

// ── Styles ───────────────────────────────────────────────────────────────────

const ACCESS = '2026-11-05T10:00:00.000Z'   // 10:00 UTC — the same calendar day in every zone a test runs in

const smg: RecordCitation = {
  service: 'Science Museum Group', serviceUrl: 'https://collection.sciencemuseumgroup.org.uk', accessDate: ACCESS,
  publisher: 'Science Museum Group', licence: 'CC BY-NC-SA 4.0', recordId: 'co49346',
  title: "'Amazon' open-end drying tumbler", url: 'https://collection.sciencemuseumgroup.org.uk/objects/co49346',
  pid: 'co49346', creator: 'Thomas Bradford & Co.', date: '1960',
}
const gbif: RecordCitation = {
  service: 'GBIF', serviceUrl: 'https://www.gbif.org', accessDate: ACCESS,
  publisher: 'Global Biodiversity Information Facility', recordId: '123',
  title: 'Title', pid: '10.15468/abc', creator: ['Smith, J.', 'Jones, K.'], date: '2019-05-03',
}
const minimal: RecordCitation = { service: 'MDS', serviceUrl: 'https://museumdata.uk', accessDate: ACCESS }

describe('formatRecordCitation — every style, full fixture (publisher = service, non-DOI pid → record URL)', () => {
  it('harvard', () => {
    expect(formatRecordCitation(smg, 'harvard')).toBe(
      "Thomas Bradford & Co. (1960) 'Amazon' open-end drying tumbler. [Online] Science Museum Group. Available at: https://collection.sciencemuseumgroup.org.uk/objects/co49346 (Accessed: 5 November 2026). Licence: CC BY-NC-SA 4.0.")
  })
  it('apa', () => {
    expect(formatRecordCitation(smg, 'apa')).toBe(
      "Thomas Bradford & Co. (1960). 'Amazon' open-end drying tumbler [Data set]. Science Museum Group. https://collection.sciencemuseumgroup.org.uk/objects/co49346")
  })
  it('mla', () => {
    expect(formatRecordCitation(smg, 'mla')).toBe(
      "Thomas Bradford & Co. \"'Amazon' open-end drying tumbler.\" Science Museum Group, 1960, https://collection.sciencemuseumgroup.org.uk/objects/co49346. Accessed 5 Nov. 2026.")
  })
  it('chicago', () => {
    expect(formatRecordCitation(smg, 'chicago')).toBe(
      "Thomas Bradford & Co. 1960. \"'Amazon' open-end drying tumbler.\" Science Museum Group. Accessed November 5, 2026. https://collection.sciencemuseumgroup.org.uk/objects/co49346.")
  })
  it('defaults to harvard', () => {
    expect(formatRecordCitation(smg)).toBe(formatRecordCitation(smg, 'harvard'))
  })
})

describe('formatRecordCitation — two creators, bare DOI, service ≠ publisher, ISO date', () => {
  it('harvard joins with "and", names service then publisher, resolves the DOI', () => {
    expect(formatRecordCitation(gbif, 'harvard')).toBe(
      'Smith, J. and Jones, K. (2019) Title. [Online] GBIF, Global Biodiversity Information Facility. Available at: https://doi.org/10.15468/abc (Accessed: 5 November 2026).')
  })
  it('apa uses ", &" and a semicolon between service and publisher', () => {
    expect(formatRecordCitation(gbif, 'apa')).toBe(
      'Smith, J., & Jones, K. (2019). Title [Data set]. GBIF; Global Biodiversity Information Facility. https://doi.org/10.15468/abc')
  })
  it('mla uses ", and" and abbreviates the access month', () => {
    expect(formatRecordCitation(gbif, 'mla')).toBe(
      'Smith, J., and Jones, K. "Title." GBIF, Global Biodiversity Information Facility, 2019, https://doi.org/10.15468/abc. Accessed 5 Nov. 2026.')
  })
  it('chicago puts the year after the authors and the URL last', () => {
    expect(formatRecordCitation(gbif, 'chicago')).toBe(
      'Smith, J., and Jones, K. 2019. "Title." GBIF, Global Biodiversity Information Facility. Accessed November 5, 2026. https://doi.org/10.15468/abc.')
  })
  it('three or more creators: harvard/chicago list them, mla uses et al.', () => {
    const three = { ...gbif, creator: ['A', 'B', 'C'] }
    expect(formatRecordCitation(three, 'harvard')).toMatch(/^A, B and C \(2019\)/)
    expect(formatRecordCitation(three, 'chicago')).toMatch(/^A, B, and C\. 2019\./)
    expect(formatRecordCitation(three, 'apa')).toMatch(/^A, B, & C\. \(2019\)\./)
    expect(formatRecordCitation(three, 'mla')).toMatch(/^A, et al\. "Title\."/)
  })
})

describe('formatRecordCitation — minimal citation', () => {
  it.each(Object.keys(CITATION_STYLES) as (keyof typeof CITATION_STYLES)[])('%s has no undefined / empty-bracket artefacts', style => {
    const s = formatRecordCitation(minimal, style)
    expect(s).not.toMatch(/undefined|null|\(\)|\[\]|\.\.|,\s*,|\s{2}/)
    expect(s).toContain('MDS')                      // the service stands in as corporate author
    expect(s).toContain('https://museumdata.uk')    // the service URL stands in for the link
    expect(s).toContain('n.d.')
  })
  it('a pid that is already a URL is used as the link', () => {
    expect(formatRecordCitation({ ...minimal, pid: 'https://doi.org/10.1234/x', url: 'https://x.org/r' }, 'apa')).toMatch(/https:\/\/doi\.org\/10\.1234\/x$/)
    expect(formatRecordCitation({ ...minimal, pid: 'doi:10.1234/x' }, 'apa')).toMatch(/https:\/\/doi\.org\/10\.1234\/x$/)
    expect(formatRecordCitation({ ...minimal, pid: 'co49346', url: 'https://x.org/r' }, 'apa')).toMatch(/https:\/\/x\.org\/r$/)
  })
  it('a title ending in punctuation does not get a second full stop', () => {
    expect(formatRecordCitation({ ...minimal, title: 'What is this?' }, 'mla')).toContain('"What is this?" ')
    expect(formatRecordCitation({ ...minimal, title: 'What is this?' }, 'harvard')).toContain('What is this? [Online]')
  })
})

describe('formatRecordCitationParts', () => {
  it('splits around the title so the node can link it; joined parts equal the string form', () => {
    for (const style of Object.keys(CITATION_STYLES) as (keyof typeof CITATION_STYLES)[]) {
      const p = formatRecordCitationParts(gbif, style)
      expect(p.title).toBe('Title')
      expect(p.before + p.title + p.after).toBe(formatRecordCitation(gbif, style))
    }
  })
})

describe('formatAllCitations', () => {
  it('numbers the citable records in the chosen style and skips the rest', () => {
    const out = formatAllCitations([{ id: 'a', _citation: smg }, { id: 'b' }, { id: 'c', _citation: gbif }], 'apa')
    expect(out.split('\n\n')).toHaveLength(2)
    expect(out).toMatch(/^\[1\] Thomas Bradford/)
    expect(out).toContain('\n\n[2] Smith, J., & Jones, K.')
  })
  it('says so when nothing is citable', () => {
    expect(formatAllCitations([{ id: 'b' }])).toBe('No citation metadata available.')
  })
})
