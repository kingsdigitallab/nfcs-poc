import { describe, it, expect } from 'vitest'
import { getFieldByPath, nonEmptyString } from '../utils/fieldPath'

describe('getFieldByPath', () => {
  const rec = { title: 'T', europeana: { thumbnail: 'https://x/y.jpg', nested: { deep: 1 } }, nul: null }

  it('resolves a top-level key', () => {
    expect(getFieldByPath(rec, 'title')).toBe('T')
  })
  it('resolves a dot-notation path', () => {
    expect(getFieldByPath(rec, 'europeana.thumbnail')).toBe('https://x/y.jpg')
    expect(getFieldByPath(rec, 'europeana.nested.deep')).toBe(1)
  })
  it('returns undefined for a missing segment or empty path', () => {
    expect(getFieldByPath(rec, 'vam.thumbnail')).toBeUndefined()
    expect(getFieldByPath(rec, 'nul.x')).toBeUndefined()
    expect(getFieldByPath(rec, '')).toBeUndefined()
  })
  it('tolerates a non-object record', () => {
    expect(getFieldByPath(null, 'a')).toBeUndefined()
    expect(getFieldByPath('str', 'a')).toBeUndefined()
  })
})

describe('nonEmptyString', () => {
  it('accepts strings with visible content', () => {
    expect(nonEmptyString('a')).toBe(true)
  })
  it('rejects empty, whitespace-only and non-strings', () => {
    expect(nonEmptyString('')).toBe(false)
    expect(nonEmptyString('   ')).toBe(false)
    expect(nonEmptyString(null)).toBe(false)
    expect(nonEmptyString(undefined)).toBe(false)
    expect(nonEmptyString(0)).toBe(false)
    expect(nonEmptyString(['x'])).toBe(false)
  })
})
