import { describe, it, expect } from 'vitest'
import { toYear, resolveRecordYear, AUTO_DATE_FIELDS } from '../utils/dateUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'

const rec = (o: Record<string, unknown>) => ({ id: 'r', title: 't', _source: 'test', ...o }) as unknown as UnifiedRecord

describe('toYear', () => {
  it('parses ISO dates and bare years', () => {
    expect(toYear('2020-06-08')).toBe(2020)
    expect(toYear('1901')).toBe(1901)
    expect(toYear('c. 1850')).toBe(1850)
  })
  it('parses negative and BCE years', () => {
    expect(toYear('-1199')).toBe(-1199)
    expect(toYear('-2599')).toBe(-2599)
    expect(toYear('2500 BCE')).toBe(-2500)
    expect(toYear('43 BC')).toBe(-43)
  })
  it('falls back to a 3-digit year', () => {
    expect(toYear('AD 793')).toBe(793)
  })
  it('returns null for empty or unparseable input', () => {
    expect(toYear(undefined)).toBeNull()
    expect(toYear(null)).toBeNull()
    expect(toYear('')).toBeNull()
    expect(toYear('unknown')).toBeNull()
  })
})

describe('resolveRecordYear', () => {
  it('declares the automatic priority periodStart → date → gbif.eventDate', () => {
    expect([...AUTO_DATE_FIELDS]).toEqual(['periodStart', 'date', 'gbif.eventDate'])
  })
  it('prefers periodStart over a modern catalogue date', () => {
    const r = rec({ date: '2020-06-08', periodStart: '-2599', periodEnd: '-0699' })
    expect(resolveRecordYear(r)).toEqual({ year: -2599, field: 'periodStart' })
  })
  it('uses date when there is no period', () => {
    expect(resolveRecordYear(rec({ date: '1901-01-01' }))).toEqual({ year: 1901, field: 'date' })
  })
  it('falls back to gbif.eventDate', () => {
    expect(resolveRecordYear(rec({ gbif: { eventDate: '1999-05-05' } }))).toEqual({ year: 1999, field: 'gbif.eventDate' })
  })
  it('skips an unparseable earlier field', () => {
    expect(resolveRecordYear(rec({ periodStart: 'Neolithic', date: '2004' }))).toEqual({ year: 2004, field: 'date' })
  })
  it('returns null when nothing parses', () => {
    expect(resolveRecordYear(rec({ title: 'x' }))).toBeNull()
  })
  it('honours a user-chosen dateField, including dot paths, and does not fall back', () => {
    const r = rec({ date: '2020-01-01', smg: { made: '1850' } })
    expect(resolveRecordYear(r, 'smg.made')).toEqual({ year: 1850, field: 'smg.made' })
    expect(resolveRecordYear(r, 'nope')).toBeNull()
  })
  it('treats an empty dateField as automatic', () => {
    expect(resolveRecordYear(rec({ date: '1066' }), '')).toEqual({ year: 1066, field: 'date' })
  })
})
