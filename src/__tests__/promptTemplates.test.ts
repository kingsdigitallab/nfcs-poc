import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  renderFieldTemplateAggregate,
  renderFieldTemplatePerRecord,
} from '../utils/promptTemplates'

describe('renderTemplate (generic)', () => {
  it('substitutes record fields', () => {
    expect(renderTemplate('Title: {{title}}', { title: 'Roman Vase' })).toBe('Title: Roman Vase')
  })

  it('renders null/undefined as empty string', () => {
    expect(renderTemplate('[{{missing}}][{{empty}}]', { empty: null })).toBe('[][]')
  })

  it('JSON-stringifies objects and arrays', () => {
    expect(renderTemplate('{{subject}}', { subject: ['a', 'b'] })).toBe('["a","b"]')
    expect(renderTemplate('{{gbif}}', { gbif: { key: 1 } })).toBe('{"key":1}')
  })

  it('supports synthetic tokens spread by callers (content, __reference, __candidate)', () => {
    const out = renderTemplate(
      'REF {{__reference}} CAND {{__candidate}} C {{content}}',
      { title: 'x', __reference: 'gold', __candidate: 'model out', content: 'body' },
    )
    expect(out).toBe('REF gold CAND model out C body')
  })

  it('leaves nothing for unmatched braces and does not recurse into substituted values', () => {
    expect(renderTemplate('{{a}}', { a: '{{b}}', b: 'nope' })).toBe('{{b}}')
  })
})

describe('renderFieldTemplateAggregate', () => {
  it('substitutes values/field/value/count', () => {
    const out = renderFieldTemplateAggregate(
      '{{count}} × {{field}}:\n{{values}}\n(alias: {{value}})',
      { values: 'a\n---\nb', field: 'title', count: 2 },
    )
    expect(out).toBe('2 × title:\na\n---\nb\n(alias: a\n---\nb)')
  })

  it('is robust to $-sequences in values (no replacement-pattern expansion)', () => {
    const out = renderFieldTemplateAggregate('{{values}}', { values: 'costs $& more', field: 'f', count: 1 })
    expect(out).toBe('costs $& more')
  })
})

describe('renderFieldTemplatePerRecord', () => {
  it('substitutes value, field, then any record token as plain string', () => {
    const out = renderFieldTemplatePerRecord(
      'V={{value}} F={{field}} T={{title}} M={{missing}}',
      { value: 'the text', field: 'description', record: { title: 'Vase', description: 'the text' } },
    )
    expect(out).toBe('V=the text F=description T=Vase M=')
  })

  it('does not JSON-stringify objects (field-node behaviour: String())', () => {
    const out = renderFieldTemplatePerRecord('{{gbif}}', {
      value: 'v', field: 'f', record: { gbif: { key: 1 } },
    })
    expect(out).toBe('[object Object]')
  })

  it('is robust to $-sequences in the field value', () => {
    const out = renderFieldTemplatePerRecord('{{value}}', { value: "$' and $&", field: 'f', record: {} })
    expect(out).toBe("$' and $&")
  })
})

describe('the {{_lineage}} token (caller-side substitution)', () => {
  it('leading-underscore tokens substitute like any other key', () => {
    const out = renderTemplate('Context:\n{{_lineage}}\n\n{{content}}', {
      content: 'record text',
      _lineage: '1. Searched ARIADNE for "x".',
    })
    expect(out).toBe('Context:\n1. Searched ARIADNE for "x".\n\nrecord text')
  })

  it('an unused _lineage key changes nothing (prompt parity when not opted in)', () => {
    const record = { content: 'record text', title: 'T' }
    const withKey = renderTemplate('{{title}}: {{content}}', { ...record, _lineage: 'ignored' })
    const without = renderTemplate('{{title}}: {{content}}', record)
    expect(withKey).toBe(without)
  })
})
