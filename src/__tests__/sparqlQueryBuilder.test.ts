import { describe, it, expect } from 'vitest'
import { buildSparqlQuery, columnVar, DEFAULT_BUILDER_STATE } from '../utils/sparqlQueryBuilder'

describe('buildSparqlQuery', () => {
  it('generates the default Turner-paintings query', () => {
    const q = buildSparqlQuery(DEFAULT_BUILDER_STATE)
    expect(q).toContain('SELECT DISTINCT ?item ?itemLabel ?itemDescription')
    expect(q).toContain('?item wdt:P31 wd:Q3305213 .')
    expect(q).toContain('?item wdt:P170 wd:Q159758 .')
    expect(q).toContain('OPTIONAL { ?item wdt:P571 ?inception . }')
    expect(q).toContain('SERVICE wikibase:label')
    expect(q).not.toMatch(/\bLIMIT\b/)   // the runner appends the limit row
  })

  it('widens instance-of via wdt:P279* when subclasses is set', () => {
    const q = buildSparqlQuery({ instanceOf: 'q839954', subclasses: true })
    expect(q).toContain('?item wdt:P31/wdt:P279* wd:Q839954 .')
  })

  it('renders a text filter value as a CONTAINS filter, a Q-id as an exact triple', () => {
    const q = buildSparqlQuery({
      instanceOf: 'Q5',
      filters: [
        { id: '1', property: 'P27', value: 'Q145' },
        { id: '2', property: 'P106', value: 'poet' },
      ],
    })
    expect(q).toContain('?item wdt:P27 wd:Q145 .')
    expect(q).toContain('?item wdt:P106 ?f1 .')
    expect(q).toContain('FILTER(CONTAINS(LCASE(STR(?f1)), "poet"))')
  })

  it('escapes quotes in literals and keywords', () => {
    const q = buildSparqlQuery({ instanceOf: 'Q571', keyword: 'say "hello"' })
    expect(q).toContain('mwapi:search "say \\"hello\\""')
  })

  it('adds the mwapi seed when a keyword is set', () => {
    const q = buildSparqlQuery({ keyword: 'stonehenge', instanceOf: 'Q839954' })
    expect(q).toContain('SERVICE wikibase:mwapi')
    expect(q).toContain('mwapi:search "stonehenge"')
    expect(q).toContain('?item wikibase:apiOutputItem mwapi:item.')
  })

  it('deduplicates columns and skips invalid property ids', () => {
    const q = buildSparqlQuery({ instanceOf: 'Q5', columns: ['P18', 'P18', 'banana', 'P569'] })
    expect(q.match(/wdt:P18/g)).toHaveLength(1)
    expect(q).not.toContain('banana')
    expect(q).toContain('OPTIONAL { ?item wdt:P569')
  })

  it('returns "" when nothing constrains ?item', () => {
    expect(buildSparqlQuery({})).toBe('')
    expect(buildSparqlQuery({ filters: [{ id: '1', property: 'not-a-pid', value: 'x' }] })).toBe('')
  })

  it('ignores filter rows with missing property or value', () => {
    const q = buildSparqlQuery({
      instanceOf: 'Q5',
      filters: [{ id: '1', property: 'P106', value: '' }, { id: '2', property: '', value: 'Q1' }],
    })
    expect(q).not.toContain('P106')
    expect(q).not.toContain('wd:Q1 ')
  })

  it('columnVar prefers the curated field name', () => {
    expect(columnVar('P571')).toBe('inception')
    expect(columnVar('P9999')).toBe('p9999')
  })
})
