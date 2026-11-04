import { describe, it, expect } from 'vitest'
import { matchFilter, applyFilters, applyTransform, applyTransforms } from '../utils/filterTransformUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { FilterOp, ExtractOp, ConcatOp, RenameOp, LowercaseOp, UppercaseOp, TruncateOp } from '../nodes/FilterTransformNode'

function rec(fields: Record<string, unknown> = {}): UnifiedRecord {
  return { id: 'r:1', ...fields } as UnifiedRecord
}

function filterOp(overrides: Partial<FilterOp>): FilterOp {
  return { id: '1', field: 'title', operator: 'contains', value: '', ...overrides }
}

// ── matchFilter ───────────────────────────────────────────────────────────────

describe('matchFilter — contains', () => {
  it('matches case-insensitively', () => {
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ value: 'iron' }))).toBe(true)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ value: 'IRON' }))).toBe(true)
  })

  it('returns false when substring absent', () => {
    expect(matchFilter(rec({ title: 'Bronze Age' }), filterOp({ value: 'iron' }))).toBe(false)
  })

  it('joins array fields with ", " before testing', () => {
    expect(matchFilter(
      rec({ subject: ['Pottery', 'Roman'] }),
      filterOp({ field: 'subject', value: 'Roman' }),
    )).toBe(true)
  })
})

describe('matchFilter — equals', () => {
  it('matches exact value', () => {
    expect(matchFilter(rec({ title: 'Bath' }), filterOp({ operator: 'equals', value: 'Bath' }))).toBe(true)
  })

  it('is case-sensitive', () => {
    expect(matchFilter(rec({ title: 'bath' }), filterOp({ operator: 'equals', value: 'Bath' }))).toBe(false)
  })
})

describe('matchFilter — startsWith', () => {
  it('matches prefix case-insensitively', () => {
    expect(matchFilter(rec({ title: 'Roman Vase' }), filterOp({ operator: 'startsWith', value: 'roman' }))).toBe(true)
  })

  it('returns false when prefix absent', () => {
    expect(matchFilter(rec({ title: 'Greek Vase' }), filterOp({ operator: 'startsWith', value: 'roman' }))).toBe(false)
  })
})

describe('matchFilter — isEmpty / isNotEmpty', () => {
  it('isEmpty matches blank field', () => {
    expect(matchFilter(rec({ title: '' }), filterOp({ operator: 'isEmpty', value: '' }))).toBe(true)
    expect(matchFilter(rec({}),            filterOp({ operator: 'isEmpty', value: '' }))).toBe(true)
  })

  it('isNotEmpty matches non-blank field', () => {
    expect(matchFilter(rec({ title: 'X' }), filterOp({ operator: 'isNotEmpty', value: '' }))).toBe(true)
    expect(matchFilter(rec({ title: '' }),  filterOp({ operator: 'isNotEmpty', value: '' }))).toBe(false)
  })
})

describe('matchFilter — greaterThan / lessThan', () => {
  it('greaterThan compares numeric values', () => {
    expect(matchFilter(rec({ count: 10 }), filterOp({ field: 'count', operator: 'greaterThan', value: '5' }))).toBe(true)
    expect(matchFilter(rec({ count: 3  }), filterOp({ field: 'count', operator: 'greaterThan', value: '5' }))).toBe(false)
  })

  it('lessThan compares numeric values', () => {
    expect(matchFilter(rec({ count: 3 }), filterOp({ field: 'count', operator: 'lessThan', value: '5' }))).toBe(true)
    expect(matchFilter(rec({ count: 10 }), filterOp({ field: 'count', operator: 'lessThan', value: '5' }))).toBe(false)
  })

  it('returns false when value is non-numeric', () => {
    expect(matchFilter(rec({ title: 'abc' }), filterOp({ operator: 'greaterThan', value: '1' }))).toBe(false)
  })
})

describe('matchFilter — dot-notation field paths', () => {
  it('resolves nested namespace fields', () => {
    expect(matchFilter(
      rec({ ads: { temporal: 'Iron Age' } }),
      filterOp({ field: 'ads.temporal', value: 'Iron' }),
    )).toBe(true)
  })

  it('returns empty string for missing namespace', () => {
    expect(matchFilter(
      rec({}),
      filterOp({ field: 'ads.temporal', operator: 'isEmpty', value: '' }),
    )).toBe(true)
  })
})

// ── applyFilters ──────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const records = [
    rec({ title: 'Iron Age Pot', date: '100' }),
    rec({ title: 'Bronze Sword', date: '200' }),
    rec({ title: 'Iron Nail',    date: '300' }),
  ]

  it('returns all records when no ops defined', () => {
    expect(applyFilters(records, [], 'AND')).toHaveLength(3)
  })

  it('AND combinator: all conditions must match', () => {
    const ops: FilterOp[] = [
      filterOp({ field: 'title', value: 'Iron' }),
      filterOp({ field: 'title', value: 'Pot' }),
    ]
    const result = applyFilters(records, ops, 'AND')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Iron Age Pot')
  })

  it('OR combinator: any condition matches', () => {
    const ops: FilterOp[] = [
      filterOp({ field: 'title', value: 'Iron' }),
      filterOp({ field: 'title', value: 'Bronze' }),
    ]
    expect(applyFilters(records, ops, 'OR')).toHaveLength(3)
  })

  it('ignores ops with empty field', () => {
    const ops: FilterOp[] = [filterOp({ field: '', value: 'Iron' })]
    expect(applyFilters(records, ops, 'AND')).toHaveLength(3)
  })
})

// ── applyTransform ────────────────────────────────────────────────────────────

describe('applyTransform — rename', () => {
  const op: RenameOp = { id: '1', type: 'rename', field: 'title', newName: 'name', dropOriginal: false }

  it('copies the field value to the new name', () => {
    const result = applyTransform({ id: 'r:1', title: 'Vase' }, op)
    expect(result.name).toBe('Vase')
  })

  it('keeps original when dropOriginal=false', () => {
    const result = applyTransform({ id: 'r:1', title: 'Vase' }, op)
    expect(result.title).toBe('Vase')
  })

  it('removes original when dropOriginal=true', () => {
    const result = applyTransform({ id: 'r:1', title: 'Vase' }, { ...op, dropOriginal: true })
    expect(result.title).toBeUndefined()
  })
})

describe('applyTransform — extract (slice)', () => {
  const op: ExtractOp = {
    id: '1', type: 'extract', field: 'title', newField: 'year',
    start: '0', end: '4', regex: '', useRegex: false,
  }

  it('slices the field value', () => {
    const result = applyTransform({ id: 'r:1', title: '1850 Ceramic Jar' }, op)
    expect(result.year).toBe('1850')
  })

  it('uses newField as the output key', () => {
    const result = applyTransform({ id: 'r:1', title: '1850 Jar' }, op)
    expect('year' in result).toBe(true)
  })
})

describe('applyTransform — extract (regex)', () => {
  const op: ExtractOp = {
    id: '1', type: 'extract', field: 'title', newField: 'century',
    start: '', end: '', regex: '(\\d+)th century', useRegex: true,
  }

  it('captures the first group', () => {
    const result = applyTransform({ id: 'r:1', title: 'Found in the 19th century' }, op)
    expect(result.century).toBe('19')
  })

  it('returns empty string when regex does not match', () => {
    const result = applyTransform({ id: 'r:1', title: 'No match here' }, op)
    expect(result.century).toBe('')
  })
})

describe('applyTransform — concat', () => {
  const op: ConcatOp = {
    id: '1', type: 'concat', field1: 'title', field2: 'date', newField: 'summary', separator: ' — ',
  }

  it('joins two fields with the separator', () => {
    const result = applyTransform({ id: 'r:1', title: 'Vase', date: '1800' }, op)
    expect(result.summary).toBe('Vase — 1800')
  })

  it('handles missing fields gracefully (empty string)', () => {
    const result = applyTransform({ id: 'r:1', title: 'Vase' }, op)
    expect(result.summary).toBe('Vase — ')
  })
})

describe('applyTransform — lowercase / uppercase', () => {
  it('lowercases a string field', () => {
    const op: LowercaseOp = { id: '1', type: 'lowercase', field: 'title' }
    const result = applyTransform({ id: 'r:1', title: 'Roman Vase' }, op)
    expect(result.title).toBe('roman vase')
  })

  it('uppercases a string field', () => {
    const op: UppercaseOp = { id: '1', type: 'uppercase', field: 'title' }
    const result = applyTransform({ id: 'r:1', title: 'Roman Vase' }, op)
    expect(result.title).toBe('ROMAN VASE')
  })

  it('lowercases each element of an array field', () => {
    const op: LowercaseOp = { id: '1', type: 'lowercase', field: 'subject' }
    const result = applyTransform({ id: 'r:1', subject: ['Pottery', 'Roman'] }, op)
    expect(result.subject).toEqual(['pottery', 'roman'])
  })
})

describe('applyTransform — truncate', () => {
  const op: TruncateOp = { id: '1', type: 'truncate', field: 'title', maxLen: '10' }

  it('truncates long values and appends ellipsis', () => {
    const result = applyTransform({ id: 'r:1', title: 'A very long title here' }, op)
    expect(result.title).toBe('A very lon…')
    expect(String(result.title).length).toBe(11)  // 10 chars + ellipsis
  })

  it('leaves short values unchanged', () => {
    const result = applyTransform({ id: 'r:1', title: 'Short' }, op)
    expect(result.title).toBe('Short')
  })
})

describe('applyTransforms', () => {
  it('chains multiple transforms in order', () => {
    const records = [rec({ title: 'Roman Vase 1850', date: '1850' })] as UnifiedRecord[]
    const ops = [
      { id: '1', type: 'lowercase' as const, field: 'title' },
      { id: '2', type: 'truncate'  as const, field: 'title', maxLen: '10' },
    ]
    const result = applyTransforms(records, ops)
    expect(result[0].title).toBe('roman vase…')
  })

  it('returns original records when no active ops', () => {
    const records = [rec({ title: 'X' })] as UnifiedRecord[]
    expect(applyTransforms(records, [])).toBe(records)
  })
})

// ── Nov 2026: negation, lists, regex, deep paths, field options ──────────────

import { parseListValue, filterFieldOptions } from '../utils/filterTransformUtils'

describe('matchFilter — notContains / notEquals / endsWith / matches', () => {
  it('notContains is the case-insensitive inverse of contains', () => {
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'notContains', value: 'iron' }))).toBe(false)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'notContains', value: 'bronze' }))).toBe(true)
  })
  it('notEquals is exact and case-sensitive like equals', () => {
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'notEquals', value: 'Iron Age' }))).toBe(false)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'notEquals', value: 'iron age' }))).toBe(true)
  })
  it('endsWith ignores case', () => {
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'endsWith', value: 'AGE' }))).toBe(true)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'endsWith', value: 'Iron' }))).toBe(false)
  })
  it('matches applies a case-insensitive regex and never throws on a bad pattern', () => {
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'matches', value: '^iron\\s+age$' }))).toBe(true)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'matches', value: '^age' }))).toBe(false)
    expect(matchFilter(rec({ title: 'Iron Age' }), filterOp({ operator: 'matches', value: '(' }))).toBe(false)
  })
})

describe('matchFilter — in / notIn lists', () => {
  const ids = 'IDS: europeana:/954/a, europeana:/883/b'
  it('in matches when the field equals any listed value (exact, case-sensitive)', () => {
    expect(matchFilter(rec({ id: 'europeana:/883/b' }), filterOp({ field: 'id', operator: 'in', value: ids }))).toBe(true)
    expect(matchFilter(rec({ id: 'europeana:/883/B' }), filterOp({ field: 'id', operator: 'in', value: ids }))).toBe(false)
    expect(matchFilter(rec({ id: 'europeana:/000/z' }), filterOp({ field: 'id', operator: 'in', value: ids }))).toBe(false)
  })
  it('notIn is the inverse', () => {
    expect(matchFilter(rec({ id: 'europeana:/883/b' }), filterOp({ field: 'id', operator: 'notIn', value: ids }))).toBe(false)
    expect(matchFilter(rec({ id: 'europeana:/000/z' }), filterOp({ field: 'id', operator: 'notIn', value: ids }))).toBe(true)
  })
  it('an empty list: in matches nothing, notIn matches everything', () => {
    expect(matchFilter(rec({ id: 'x' }), filterOp({ field: 'id', operator: 'in', value: '' }))).toBe(false)
    expect(matchFilter(rec({ id: 'x' }), filterOp({ field: 'id', operator: 'notIn', value: '' }))).toBe(true)
  })
  it('array fields match element-wise for equals / notEquals / in / notIn', () => {
    const r = rec({ subject: ['Bronze Age', 'Barrow'] })
    expect(matchFilter(r, filterOp({ field: 'subject', operator: 'equals', value: 'Barrow' }))).toBe(true)
    expect(matchFilter(r, filterOp({ field: 'subject', operator: 'notEquals', value: 'Barrow' }))).toBe(false)
    expect(matchFilter(r, filterOp({ field: 'subject', operator: 'in', value: 'Barrow\nHillfort' }))).toBe(true)
    expect(matchFilter(r, filterOp({ field: 'subject', operator: 'notIn', value: 'Barrow\nHillfort' }))).toBe(false)
  })
})

describe('parseListValue', () => {
  it('splits on commas and newlines, trims, drops blanks', () => {
    expect(parseListValue(' a, b ,\n\nc\n')).toEqual(['a', 'b', 'c'])
  })
  it('strips a leading IDS: label so the recipe-3.6 line pastes verbatim', () => {
    expect(parseListValue('IDS: a, b')).toEqual(['a', 'b'])
    expect(parseListValue('ids:a')).toEqual(['a'])
    expect(parseListValue('IDS: none')).toEqual(['none'])
  })
  it('returns [] for empty input', () => {
    expect(parseListValue('')).toEqual([])
    expect(parseListValue('IDS:')).toEqual([])
  })
})

describe('matchFilter — deep dot paths', () => {
  it('walks more than one level and lets a flat dotted key win', () => {
    expect(matchFilter(rec({ a: { b: { c: 'deep' } } }), filterOp({ field: 'a.b.c', value: 'deep' }))).toBe(true)
    expect(matchFilter(rec({ 'a.b': 'flat', a: { b: 'nested' } }), filterOp({ field: 'a.b', operator: 'equals', value: 'flat' }))).toBe(true)
  })
})

describe('filterFieldOptions', () => {
  const records = [
    rec({ id: 'europeana:1', _source: 'europeana', _pid: 'p', title: 'T', europeana: { rights: 'CC0', year: 1800 } }),
    rec({ id: 'gbif:2', _source: 'gbif', title: 'U', gbif: { year: 1999, scientificName: 'Felis' }, decimalLatitude: 51.5 }),
    rec({ id: 'ariadne:3', _source: 'ariadne', ariadne: { contributor: 'ADS' } }),
  ]
  const paths = () => filterFieldOptions(records).map(o => o.path)

  it('offers id and _source, every namespace, numeric fields and coordinates', () => {
    expect(paths()).toEqual(expect.arrayContaining(['id', '_source', 'title', 'europeana.rights', 'europeana.year', 'gbif.year', 'gbif.scientificName', 'ariadne.contributor', 'decimalLatitude']))
  })
  it('does not offer other _-prefixed keys', () => {
    expect(paths()).not.toContain('_pid')
  })
  it('groups core fields before namespaces and reports population counts', () => {
    const opts = filterFieldOptions(records)
    expect(opts[0]).toMatchObject({ group: 'core', path: 'id', count: 3, total: 3 })
    expect(opts.find(o => o.path === 'gbif.year')).toMatchObject({ group: 'gbif', count: 1, total: 3 })
    const groups = [...new Set(opts.map(o => o.group))]
    expect(groups[0]).toBe('core')
  })
  it('returns [] with no records', () => {
    expect(filterFieldOptions([])).toEqual([])
  })
})
