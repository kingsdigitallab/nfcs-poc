/**
 * aggregateFieldValues — the ONE builder of the {{values}} block for the
 * field-inference nodes' aggregate mode (KCL + Ollama, runner + component).
 *
 * Before Nov 2026 four hand-copied join blocks sent bare values; the model
 * could describe the set but never name a record. Each value is now headed
 * by "id: <id> · title (Source)" so answers can cite ids that Filter and
 * Transform can act on.
 */
import { describe, it, expect } from 'vitest'
import { aggregateFieldValues, recordHeading, DEFAULT_AGGREGATE_PROMPT } from '../utils/aggregateValues'

const rec = (i: number, desc: string | undefined = `Description ${i}`) => ({
  id: `vam:${i}`, _source: 'vam', title: `Stone Henge ${i}`, description: desc,
  vam: { objectType: `Type ${i}` },
})

describe('recordHeading', () => {
  it('reads "id: <id> · title (Source)" — the id is named, not numbered, so the model cannot cite a position instead', () => {
    expect(recordHeading(rec(3))).toBe('id: vam:3 · Stone Henge 3 (V&A)')
  })
  it('omits the title when it is empty or just the id', () => {
    expect(recordHeading({ id: 'x:1', _source: 'gbif', title: '' })).toBe('id: x:1 (GBIF)')
    expect(recordHeading({ id: 'x:1', _source: 'gbif', title: 'x:1' })).toBe('id: x:1 (GBIF)')
  })
  it('omits the source bracket when _source is missing', () => {
    expect(recordHeading({ id: 'x:1', title: 'T' })).toBe('id: x:1 · T')
  })
  it('never contains a bare bracketed number the model could mistake for the id', () => {
    expect(recordHeading(rec(8))).not.toMatch(/\[\d+\]/)
  })
})

describe('aggregateFieldValues', () => {
  it('heads every value with its record heading and joins with ---', () => {
    const r = aggregateFieldValues([rec(1), rec(2)], 'description')
    expect(r.values).toBe('id: vam:1 · Stone Henge 1 (V&A)\nDescription 1\n---\nid: vam:2 · Stone Henge 2 (V&A)\nDescription 2')
    expect(r.included).toBe(2)
    expect(r.total).toBe(2)
  })

  it('label: false reproduces the legacy bare join byte for byte', () => {
    const r = aggregateFieldValues([rec(1), rec(2)], 'description', { label: false })
    expect(r.values).toBe('Description 1\n---\nDescription 2')
  })

  it('drops empty values and counts only what was sent', () => {
    const r = aggregateFieldValues([rec(1), rec(2, ''), { ...rec(3), description: undefined }, rec(4, '   ')], 'description')
    expect(r.values).toBe('id: vam:1 · Stone Henge 1 (V&A)\nDescription 1')
    expect(r.included).toBe(1)
    expect(r.total).toBe(4)
  })

  it('resolves dot paths, with a flat key taking precedence', () => {
    expect(aggregateFieldValues([rec(1)], 'vam.objectType', { label: false }).values).toBe('Type 1')
    const flat = { id: 'a', 'vam.objectType': 'FLAT', vam: { objectType: 'NESTED' } }
    expect(aggregateFieldValues([flat], 'vam.objectType', { label: false }).values).toBe('FLAT')
  })

  it('joins array values with "; "', () => {
    expect(aggregateFieldValues([{ id: 'a', tags: ['x', 'y'] }], 'tags', { label: false }).values).toBe('x; y')
  })

  it('truncates each value to max(500, maxChars / total) before heading it', () => {
    const long = 'a'.repeat(2000)
    const r = aggregateFieldValues([rec(1, long), rec(2, long)], 'description', { maxChars: 1400 })
    // perValMax = max(500, floor(1400/2)) = 700 → 700 chars + '…'; two such items (734 each + sep)
    // overflow 1400, so only the first survives — and it is cut by perValMax, not by the budget.
    expect(r.values).toBe('id: vam:1 · Stone Henge 1 (V&A)\n' + 'a'.repeat(700) + '…')
    expect(r.included).toBe(1)
  })

  it('stops adding whole items at the maxChars budget — a heading is never cut in half', () => {
    const r = aggregateFieldValues([rec(1), rec(2), rec(3)], 'description', { maxChars: 90 })
    // Item 1 = 45 chars; item 1 + sep + item 2 = 95 > 90 → only item 1 survives
    expect(r.values).toBe('id: vam:1 · Stone Henge 1 (V&A)\nDescription 1')
    expect(r.included).toBe(1)
    expect(r.total).toBe(3)
  })

  it('uncapped when maxChars is omitted', () => {
    const long = 'b'.repeat(5000)
    const r = aggregateFieldValues([rec(1, long)], 'description', { label: false })
    expect(r.values).toBe(long)
  })

  it('tolerates a record without an id', () => {
    expect(aggregateFieldValues([{ description: 'D' }], 'description').values).toBe('id:\nD')
  })

  it('exports the shared default aggregate prompt mentioning the headings and ids', () => {
    expect(DEFAULT_AGGREGATE_PROMPT).toContain('{{values}}')
    expect(DEFAULT_AGGREGATE_PROMPT).toContain('{{count}}')
    expect(DEFAULT_AGGREGATE_PROMPT).toMatch(/record id/i)
  })
})
