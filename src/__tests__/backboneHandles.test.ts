/**
 * Handle-contract regression net for every node on the BackboneSearchNode
 * shell. Edges in saved .nfcs.json workflows reference handle ids AND the
 * top offsets are load-bearing (CLAUDE.md gotcha 16 class): query row 0 at
 * top 51, limit row 1 at top 78, output 'results'. These tests pin the
 * layout maths and each migrated config's serialised data keys — if either
 * moves, saved workflows break silently.
 */
import { describe, it, expect, vi } from 'vitest'

// The shell imports the full nodeRunners registry (heavy transitive imports);
// the configs under test don't need it.
vi.mock('../utils/nodeRunners', () => ({ nodeRunners: {} }))

import { handleTop, filterValueKeys, type BackboneSearchConfig } from '../nodes/BackboneSearchNode'
import { ARIADNE_CONFIG } from '../nodes/ARIADNESearchNode'
import { HSDS_CONFIG } from '../nodes/HSDSSearchNode'

describe('backbone handle contract', () => {
  it('wirable-row offsets are byte-identical to the pre-shell components', () => {
    expect(handleTop(0)).toBe(51)   // query
    expect(handleTop(1)).toBe(78)   // limit
  })

  it('range filters write ${key}From / ${key}To', () => {
    expect(filterValueKeys({ key: 'year', label: 'Year', kind: 'range' })).toEqual(['yearFrom', 'yearTo'])
    expect(filterValueKeys({ key: 'country', label: 'Country', kind: 'select' })).toEqual(['country'])
  })
})

/** The serialised data keys a config writes — must never change per node. */
function serialisedFilterKeys(config: BackboneSearchConfig): string[] {
  return (config.filters ?? []).flatMap(filterValueKeys)
}

describe('ARIADNE config (post-generalisation parity)', () => {
  it('keeps the exact pre-shell filter data keys, in order', () => {
    expect(serialisedFilterKeys(ARIADNE_CONFIG)).toEqual([
      'ariadneSubject', 'derivedSubject', 'nativeSubject',
      'country', 'dataType', 'temporal', 'contributor',
    ])
  })

  it('keeps dual-select sort and the fetch-all checkbox', () => {
    expect(ARIADNE_CONFIG.sort?.options.map(o => o.value)).toEqual(['_score', 'title', 'issued'])
    expect(ARIADNE_CONFIG.sort?.singleSelect).toBeUndefined()
    expect(ARIADNE_CONFIG.fetchAll).toBe(true)
    expect(ARIADNE_CONFIG.nodeType).toBe('ariadneSearch')
    expect(ARIADNE_CONFIG.queryDataKey ?? 'inlineQuery').toBe('inlineQuery')
  })
})

describe('HSDS config (post-generalisation parity)', () => {
  it('keeps the exact pre-shell filter data keys, in order', () => {
    expect(serialisedFilterKeys(HSDS_CONFIG)).toEqual([
      'ariadneSubject', 'derivedSubject', 'nativeSubject',
      'country', 'dataType', 'temporal', 'contributor',
    ])
  })

  it('keeps dual-select sort and the fetch-all checkbox', () => {
    expect(HSDS_CONFIG.sort?.options.map(o => o.value)).toEqual(['_score', 'title', 'issued', 'modified'])
    expect(HSDS_CONFIG.fetchAll).toBe(true)
    expect(HSDS_CONFIG.nodeType).toBe('hsdsSearch')
  })
})
