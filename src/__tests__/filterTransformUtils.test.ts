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
