import { describe, it, expect } from 'vitest'
import { groupExamples, slugify, type ExampleMeta } from '../utils/examplesClient'

const ex = (slug: string, group?: string): ExampleMeta => ({ slug, title: slug, description: '', group })

describe('slugify', () => {
  it('lower-cases, collapses non-alphanumerics to one hyphen and trims the ends', () => {
    expect(slugify('Stonehenge II')).toBe('stonehenge-ii')
    expect(slugify('  LLM: Extraction / task  ')).toBe('llm-extraction-task')
    expect(slugify('---')).toBe('')
  })
})

describe('groupExamples', () => {
  it('keeps ungrouped examples flat and builds one group per distinct name in first-seen order', () => {
    const { ungrouped, groups } = groupExamples([
      ex('a'), ex('b', 'Workshop'), ex('c', ''), ex('d', 'Teaching'), ex('e', 'Workshop'), ex('f', '  '),
    ])
    expect(ungrouped.map(x => x.slug)).toEqual(['a', 'c', 'f'])
    expect(groups.map(g => [g.name, g.items.map(x => x.slug)])).toEqual([
      ['Workshop', ['b', 'e']],
      ['Teaching', ['d']],
    ])
  })

  it('returns empty structures for an empty manifest', () => {
    expect(groupExamples([])).toEqual({ ungrouped: [], groups: [] })
  })
})
