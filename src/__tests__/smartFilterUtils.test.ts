/**
 * smartFilterUtils — the pure half of Smart Filter: deterministic evaluation
 * of the LLM-produced conditions object, and tolerant parsing of the model
 * reply. Extracted from SmartFilterNode.tsx (Nov 2026) when "remove records
 * whose id is in this list" could not be expressed (no notIn) and a long id
 * list truncated the JSON into an opaque parse error.
 */
import { describe, it, expect } from 'vitest'
import { applySmartFilter, testCondition, parseSmartFilterResponse, OP_LABELS } from '../utils/smartFilterUtils'
import type { SmartFilter } from '../utils/smartFilterUtils'

const recs = [
  { id: 'e:1', _source: 'europeana', title: 'Barrow', subject: ['Bronze Age', 'Barrow'] },
  { id: 'e:2', _source: 'europeana', title: 'Hillfort' },
  { id: 'g:3', _source: 'gbif',      title: 'Felis', gbif: { year: 1999 } },
]

describe('testCondition — in / notIn on id', () => {
  it('in: field equals any listed value (case-insensitive by default)', () => {
    expect(testCondition(recs[0], { field: 'id', op: 'in', value: ['E:1', 'e:2'] })).toBe(true)
    expect(testCondition(recs[2], { field: 'id', op: 'in', value: ['e:1', 'e:2'] })).toBe(false)
  })
  it('notIn: field equals none of the listed values', () => {
    expect(testCondition(recs[0], { field: 'id', op: 'notIn', value: ['e:1', 'e:2'] })).toBe(false)
    expect(testCondition(recs[2], { field: 'id', op: 'notIn', value: ['e:1', 'e:2'] })).toBe(true)
  })
  it('notIn on an array field passes only when no element is listed', () => {
    expect(testCondition(recs[0], { field: 'subject', op: 'notIn', value: ['Barrow'] })).toBe(false)
    expect(testCondition(recs[0], { field: 'subject', op: 'notIn', value: ['Hillfort'] })).toBe(true)
  })
  it('notIn across several fields requires every field to pass', () => {
    expect(testCondition(recs[0], { fields: ['id', 'title'], op: 'notIn', value: ['Barrow'] })).toBe(false)
    expect(testCondition(recs[1], { fields: ['id', 'title'], op: 'notIn', value: ['Barrow'] })).toBe(true)
  })
  it('has a display label', () => {
    expect(OP_LABELS.notIn).toBe('is not in list')
  })
})

describe('testCondition — existing semantics kept', () => {
  it('notExists on a missing deep path', () => {
    expect(testCondition(recs[0], { field: 'gbif.year', op: 'notExists' })).toBe(true)
    expect(testCondition(recs[2], { field: 'gbif.year', op: 'notExists' })).toBe(false)
  })
  it('_-prefixed fields such as _source are evaluable', () => {
    expect(testCondition(recs[2], { field: '_source', op: 'equals', value: 'gbif' })).toBe(true)
  })
})

describe('applySmartFilter', () => {
  it('"remove these ids" = notIn keeps the rest', () => {
    const f: SmartFilter = { logic: 'AND', conditions: [{ field: 'id', op: 'notIn', value: ['e:1', 'g:3'] }], explanation: '' }
    expect(applySmartFilter(recs, f).map(r => r.id)).toEqual(['e:2'])
  })
  it('skips disabled conditions', () => {
    const f: SmartFilter = { logic: 'AND', conditions: [{ field: 'id', op: 'notIn', value: ['e:1'] }], explanation: '' }
    expect(applySmartFilter(recs, f, [true])).toHaveLength(3)
  })
})

describe('parseSmartFilterResponse', () => {
  const good = '{"logic":"AND","conditions":[{"field":"id","op":"notIn","value":["a","b"]}],"explanation":"x"}'

  it('parses plain JSON', () => {
    expect(parseSmartFilterResponse(good).filter?.conditions[0].op).toBe('notIn')
  })
  it('strips markdown fences', () => {
    expect(parseSmartFilterResponse('```json\n' + good + '\n```').filter?.logic).toBe('AND')
  })
  it('tolerates prose around the object', () => {
    expect(parseSmartFilterResponse('Here you go:\n' + good + '\nHope that helps.').filter?.explanation).toBe('x')
  })
  it('names truncation when the JSON is cut off', () => {
    const r = parseSmartFilterResponse(good.slice(0, 60))
    expect(r.filter).toBeUndefined()
    expect(r.error).toMatch(/truncated|cut off/i)
  })
  it('names an unknown operator', () => {
    const r = parseSmartFilterResponse('{"logic":"AND","conditions":[{"field":"id","op":"notInList","value":[]}],"explanation":""}')
    expect(r.filter).toBeUndefined()
    expect(r.error).toMatch(/notInList/)
  })
  it('rejects a reply without a conditions array', () => {
    expect(parseSmartFilterResponse('{"logic":"AND"}').error).toMatch(/conditions/)
  })
  it('defaults logic to AND when missing', () => {
    expect(parseSmartFilterResponse('{"conditions":[]}').filter?.logic).toBe('AND')
  })
})
