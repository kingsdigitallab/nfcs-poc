/**
 * Pins the data-key names each describer reads. The keys are NOT uniform
 * across node types (that inconsistency is real, verified against the
 * runners) — if a runner ever renames its keys, these tests fail before the
 * lineage narrative silently goes blank.
 */
import { describe, it, expect } from 'vitest'
import type { Node } from '@xyflow/react'
import { describeNode, lineageDescribers } from '../utils/lineageDescribers'

function mk(type: string, data: Record<string, unknown>): Node {
  return { id: 'n1', type, position: { x: 0, y: 0 }, data }
}

describe('lineageDescribers', () => {
  it('ariadneSearch: query, facets, count', () => {
    const s = describeNode(mk('ariadneSearch', {
      inlineQuery: 'stonehenge', country: 'United Kingdom', temporal: 'Iron Age', count: 50,
    }))
    expect(s).toContain('ARIADNE')
    expect(s).toContain('"stonehenge"')
    expect(s).toContain('Country=United Kingdom')
    expect(s).toContain('Period=Iron Age')
    expect(s).toContain('50 results')
  })

  it('gbifSearch: inlineQ key + capped totals', () => {
    const s = describeNode(mk('gbifSearch', {
      inlineQ: 'quercus', inlineCountry: 'GB', count: 300, _capped: true, _total: 5120,
    }))
    expect(s).toContain('"quercus"')
    expect(s).toContain('Country=GB')
    expect(s).toContain('300 of 5120')
  })

  it('filterTransform: ops, combinator, inputCount/outputCount', () => {
    const s = describeNode(mk('filterTransform', {
      filterOps: [
        { id: '1', field: 'title', operator: 'contains', value: 'Iron Age' },
        { id: '2', field: 'country', operator: 'equals', value: 'England' },
      ],
      filterCombinator: 'AND',
      transformOps: [{ id: '3', type: 'rename', field: 'ariadne.nativePeriod', newName: 'period', dropOriginal: true }],
      inputCount: 400, outputCount: 60,
    }))
    expect(s).toContain('title contains "Iron Age"')
    expect(s).toContain(' AND ')
    expect(s).toContain('renamed "ariadne.nativePeriod" → "period"')
    expect(s).toContain('60 of 400 records passed')
  })

  it('smartFilter: generatedFilter.explanation verbatim + matchCount/totalCount', () => {
    const s = describeNode(mk('smartFilter', {
      generatedFilter: { logic: 'AND', conditions: [], explanation: 'Records mentioning Roman coins' },
      matchCount: 12, totalCount: 88,
    }))
    expect(s).toContain('Records mentioning Roman coins')
    expect(s).toContain('12 of 88')
  })

  it('deduplicate: dedupeField + removedCount', () => {
    const s = describeNode(mk('deduplicate', {
      dedupeField: 'title', inputCount: 88, outputCount: 61, removedCount: 27,
    }))
    expect(s).toContain('"title"')
    expect(s).toContain('61 unique of 88')
    expect(s).toContain('27 duplicates removed')
  })

  it('spatialFilter: bbox + in/out', () => {
    const s = describeNode(mk('spatialFilter', {
      bbox: { north: 51.6, south: 51.2, east: -1.5, west: -2.1 }, inputCount: 61, outputCount: 20,
    }))
    expect(s).toContain('51.20..51.60N')
    expect(s).toContain('20 of 61 records inside')
  })

  it('reconciliation: selectedField/selectedAuthority/threshold + resolvedCount/reviewCount', () => {
    const s = describeNode(mk('reconciliation', {
      selectedField: 'gbif.scientificName', selectedAuthority: 'Wikidata (taxon)',
      confidenceThreshold: 0.8, resolvedCount: 15, reviewCount: 5,
    }))
    expect(s).toContain('"gbif.scientificName"')
    expect(s).toContain('Wikidata (taxon)')
    expect(s).toContain('threshold 0.8')
    expect(s).toContain('15 auto-resolved, 5 for review')
  })

  it('mergeByQID: mergedCount/unmatchedCount + keepUnmatched', () => {
    const s = describeNode(mk('mergeByQID', { mergedCount: 34, unmatchedCount: 9, keepUnmatched: true }))
    expect(s).toContain('34 merged entities')
    expect(s).toContain('9 unmatched (kept)')
  })

  it('geocoding: placeField + bare resolved/pending/failed keys', () => {
    const s = describeNode(mk('geocoding', {
      placeField: 'spatialCoverage', resolved: 40, pending: 3, failed: 2,
    }))
    expect(s).toContain('"spatialCoverage"')
    expect(s).toContain('40 resolved, 3 pending review, 2 failed')
  })

  it('kclNode: model + clipped prompt', () => {
    const s = describeNode(mk('kclNode', {
      model: 'arc:lite', userPromptTemplate: 'Summarise: {{content}}',
    }))
    expect(s).toContain('arc:lite')
    expect(s).toContain('Summarise: {{content}}')
  })

  it('kclField / ollamaField: model, mode, selectedField', () => {
    const s = describeNode(mk('kclField', { model: 'arc:nano', mode: 'aggregate', selectedField: 'description' }))
    expect(s).toContain('arc:nano')
    expect(s).toContain('aggregate')
    expect(s).toContain('"description"')
  })

  it('urlFetch: urlField + renderJs + outputCount', () => {
    const s = describeNode(mk('urlFetch', { urlField: 'adsLibrary.downloadUrl', renderJs: true, outputCount: 7 }))
    expect(s).toContain('"adsLibrary.downloadUrl"')
    expect(s).toContain('JS-rendered')
    expect(s).toContain('7 records')
  })

  it('htmlSection / xmlSection: selector and xpath', () => {
    expect(describeNode(mk('htmlSection', { selector: 'main article' }))).toContain('"main article"')
    expect(describeNode(mk('xmlSection', { xpath: '//teiHeader' }))).toContain('"//teiHeader"')
  })

  it('unknown types fall back to label + counts', () => {
    const s = describeNode(mk('tableOutput', { count: 12 }))
    expect(s).toContain('12')
  })

  it('registry keys are all real node types (compile-time guard is satisfies; spot-check one)', () => {
    expect(Object.keys(lineageDescribers)).toContain('ariadneSearch')
  })
})
