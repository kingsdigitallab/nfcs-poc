import { describe, it, expect } from 'vitest'
import { isReconciledValue, candidateFields, authoritiesForField } from '../utils/reconciliationService'
import type { ReconciliationResult } from '../utils/reconciliationService'

function resolved(overrides: Partial<ReconciliationResult> = {}): ReconciliationResult {
  return {
    qid: 'Q42', label: 'Douglas Adams', description: null,
    confidence: 0.95, status: 'resolved', candidates: [], authority: 'wikidata-person',
    ...overrides,
  }
}

// ── isReconciledValue ─────────────────────────────────────────────────────────

describe('isReconciledValue', () => {
  it('returns true for a resolved result', () => {
    expect(isReconciledValue(resolved())).toBe(true)
  })

  it('returns true for a review result', () => {
    expect(isReconciledValue(resolved({ status: 'review' }))).toBe(true)
  })

  it('returns false for null', () => {
    expect(isReconciledValue(null)).toBe(false)
  })

  it('returns false for a plain string', () => {
    expect(isReconciledValue('Q42')).toBe(false)
  })

  it('returns false for an object without status', () => {
    expect(isReconciledValue({ qid: 'Q42' })).toBe(false)
  })

  it('returns false for an object with an unknown status', () => {
    expect(isReconciledValue({ status: 'pending' })).toBe(false)
  })
})

// ── authoritiesForField ───────────────────────────────────────────────────────

describe('authoritiesForField', () => {
  it('returns place authorities for "country"', () => {
    const auths = authoritiesForField('country')
    expect(auths.some(a => a.value === 'wikidata-place')).toBe(true)
  })

  it('returns taxon authorities for "scientificName"', () => {
    const auths = authoritiesForField('scientificName')
    expect(auths.some(a => a.value === 'wikidata-taxon')).toBe(true)
  })

  it('falls back to wikidata-item for unknown fields', () => {
    const auths = authoritiesForField('someRandomField')
    expect(auths.some(a => a.value === 'wikidata-item')).toBe(true)
  })

  it('returns person authorities for "creator"', () => {
    const auths = authoritiesForField('creator')
    expect(auths.some(a => a.value === 'wikidata-person')).toBe(true)
  })
})

// ── candidateFields ───────────────────────────────────────────────────────────

describe('candidateFields', () => {
  it('includes plain string fields', () => {
    const fields = candidateFields({ title: 'Roman Vase', description: 'A red pot' })
    expect(fields).toContain('title')
    expect(fields).toContain('description')
  })

  it('excludes known metadata fields (id, _source, decimalLatitude)', () => {
    const fields = candidateFields({ id: 'x:1', _source: 'gbif', decimalLatitude: 51.5, title: 'Vase' })
    expect(fields).not.toContain('id')
    expect(fields).not.toContain('_source')
    expect(fields).not.toContain('decimalLatitude')
    expect(fields).toContain('title')
  })

  it('excludes _reconciled suffixed fields', () => {
    const fields = candidateFields({ title: 'Vase', title_reconciled: { status: 'resolved' } })
    expect(fields).not.toContain('title_reconciled')
    expect(fields).toContain('title')
  })

  it('excludes null and undefined values', () => {
    const fields = candidateFields({ title: 'Vase', description: null, creator: undefined })
    expect(fields).not.toContain('description')
    expect(fields).not.toContain('creator')
  })

  it('excludes numeric fields', () => {
    const fields = candidateFields({ count: 5, title: 'Vase' })
    expect(fields).not.toContain('count')
    expect(fields).toContain('title')
  })

  it('excludes namespace object keys by default', () => {
    const fields = candidateFields({ gbif: { key: 123 }, title: 'Vase' })
    expect(fields).not.toContain('gbif')
  })

  it('expands namespace keys when expandNamespaces=true', () => {
    const fields = candidateFields({ gbif: { taxonKey: 123, vernacularName: 'Oak' } }, true)
    expect(fields).toContain('gbif.vernacularName')
  })

  it('accepts an array of records and unions their fields', () => {
    const fields = candidateFields([
      { title: 'Vase' },
      { creator: 'Smith' },
    ])
    expect(fields).toContain('title')
    expect(fields).toContain('creator')
  })

  it('includes array-valued fields (string arrays)', () => {
    const fields = candidateFields({ subject: ['Pottery', 'Roman'] })
    expect(fields).toContain('subject')
  })
})
