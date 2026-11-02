/**
 * Node visibility tiers (Basic / Intermediate / Full).
 *
 * Pins (a) the pure tier helpers and the legacy Simple/Advanced migration,
 * and (b) the EXACT palette contents at each tier, so a stray `tier:` edit in
 * sidebarItems.ts surfaces here rather than as a silently missing node.
 */
import { describe, it, expect } from 'vitest'
import { NODE_TIERS, TIER_LABELS, TIER_HINTS, tierIncludes, resolveStoredTier } from '../config/nodeTiers'
import { SIDEBAR_ITEMS, visibleSidebarItems } from '../config/sidebarItems'

describe('nodeTiers helpers', () => {
  it('orders tiers basic < intermediate < full', () => {
    expect(NODE_TIERS).toEqual(['basic', 'intermediate', 'full'])
  })

  it('tierIncludes: a tier includes itself and every lower tier, never a higher one', () => {
    expect(tierIncludes('basic', 'basic')).toBe(true)
    expect(tierIncludes('basic', 'intermediate')).toBe(false)
    expect(tierIncludes('basic', 'full')).toBe(false)
    expect(tierIncludes('intermediate', 'basic')).toBe(true)
    expect(tierIncludes('intermediate', 'intermediate')).toBe(true)
    expect(tierIncludes('intermediate', 'full')).toBe(false)
    expect(tierIncludes('full', 'basic')).toBe(true)
    expect(tierIncludes('full', 'full')).toBe(true)
  })

  it('has a label and a hint for every tier', () => {
    for (const t of NODE_TIERS) {
      expect(TIER_LABELS[t]).toBeTruthy()
      expect(TIER_HINTS[t]).toBeTruthy()
    }
    expect(TIER_LABELS.basic).toBe('Basic')
    expect(TIER_LABELS.intermediate).toBe('Intermediate')
    expect(TIER_LABELS.full).toBe('Full')
  })

  it('resolveStoredTier prefers a valid stored tier over the legacy key', () => {
    expect(resolveStoredTier('intermediate', 'true')).toBe('intermediate')
    expect(resolveStoredTier('full', 'true')).toBe('full')
    expect(resolveStoredTier('basic', 'false')).toBe('basic')
  })

  it('migrates legacy simple-mode "true" → basic', () => {
    expect(resolveStoredTier(null, 'true')).toBe('basic')
  })

  it('migrates legacy simple-mode "false" (Advanced) → full', () => {
    expect(resolveStoredTier(null, 'false')).toBe('full')
  })

  it('falls back to basic when nothing (or garbage) is stored', () => {
    expect(resolveStoredTier(null, null)).toBe('basic')
    expect(resolveStoredTier('', null)).toBe('basic')
    expect(resolveStoredTier('advanced', null)).toBe('basic')
    expect(resolveStoredTier('nonsense', 'maybe')).toBe('basic')
  })
})

describe('sidebar tiers', () => {
  const BASIC = [
    'param', 'comment',
    'ariadneSearch', 'hsdsSearch', 'bodleianSearch', 'europeanaSearch', 'gbifSearch',
    'lldsSearch', 'mdsSearch', 'nhmSearch', 'smgSearch', 'vaSearch',
    'localFileSource', 'sampleDataSource',
    'kclNode', 'kclField',
    'fieldDistribution', 'sourceProfile',
    'tableOutput', 'mapOutput', 'timelineView',
    'citation', 'export', 'saveSearch', 'loadSavedSearch',
  ]
  const INTERMEDIATE_ADDS = [
    'quickStart',
    'localFolderSource', 'urlFetch',
    'htmlSection', 'xmlSection', 'reconciliation', 'wikidataEnrich',
    'filterTransform', 'deduplicate',
    'quickView', 'imageView', 'htmlPreview',
    'jsonOutput',
    'sparqlSearch',
  ]
  const FULL_ADDS = [
    'geocoding', 'smartGeocoder', 'mergeByQID', 'quickNote', 'ollamaNode', 'ollamaField',
    'smartFilter', 'spatialFilter', 'evaluatorNode',
    'kclOutput', 'comparisonReport', 'ollamaOutput',
    'frameSenseSource',
  ]
  const types = (tier: 'basic' | 'intermediate' | 'full') =>
    visibleSidebarItems(tier).map(i => i.type).sort()

  it('Basic shows exactly the fundamental set', () => {
    expect(types('basic')).toEqual([...BASIC].sort())
  })

  it('Intermediate = Basic + the common power tools', () => {
    expect(types('intermediate')).toEqual([...BASIC, ...INTERMEDIATE_ADDS].sort())
  })

  it('Full = every non-hidden item', () => {
    expect(types('full')).toEqual([...BASIC, ...INTERMEDIATE_ADDS, ...FULL_ADDS].sort())
    expect(types('full')).toEqual(SIDEBAR_ITEMS.filter(i => !i.hidden).map(i => i.type).sort())
  })

  it('every item declares a tier', () => {
    for (const i of SIDEBAR_ITEMS) expect(NODE_TIERS).toContain(i.tier)
  })

  it('timelineOutput stays registered but is hidden from the palette (alias of timelineView)', () => {
    const alias = SIDEBAR_ITEMS.find(i => i.type === 'timelineOutput')
    expect(alias?.hidden).toBe(true)
    expect(alias?.label).toBe('Timeline')
    expect(types('full')).not.toContain('timelineOutput')
  })

  it('uses the plain-English display names', () => {
    const label = (t: string) => SIDEBAR_ITEMS.find(i => i.type === t)?.label
    expect(label('param')).toBe('Search Parameter')
    expect(label('kclNode')).toBe('AI Inference')
    expect(label('kclField')).toBe('AI Inference (by field)')
    expect(label('kclOutput')).toBe('AI Inference Output')
    expect(label('filterTransform')).toBe('Filter and Transform')
    expect(label('timelineView')).toBe('Timeline')
  })

  it('no label still carries a legacy name', () => {
    for (const i of SIDEBAR_ITEMS) {
      expect(i.label).not.toMatch(/KingsInference|FilterTransform|TimelineView|TimelineOutput/)
      expect(i.label).not.toBe('Param')
    }
  })
})

describe('connection suggestions respect the tier', () => {
  it('Basic never offers a node the palette hides at Basic', async () => {
    const { getSuggestions } = await import('../components/ConnectionSuggestions')
    const { visibleSidebarItems } = await import('../config/sidebarItems')
    const basicTypes = new Set(visibleSidebarItems('basic').map(i => i.type))
    for (const src of ['gbifSearch', 'tableOutput', 'kclNode', 'param', 'sampleDataSource', 'filterTransform']) {
      for (const s of getSuggestions(src, 'basic')) expect(basicTypes.has(s.type as never)).toBe(true)
    }
    const basicFromSearch = getSuggestions('gbifSearch', 'basic').map(s => s.type)
    expect(basicFromSearch).not.toContain('smartFilter')
    expect(basicFromSearch).not.toContain('reconciliation')
    expect(basicFromSearch).not.toContain('urlFetch')
    expect(basicFromSearch).toContain('tableOutput')
  })

  it('Full offers the complete suggestion set', async () => {
    const { getSuggestions } = await import('../components/ConnectionSuggestions')
    const full = getSuggestions('gbifSearch', 'full').map(s => s.type)
    expect(full).toEqual(expect.arrayContaining(['smartFilter', 'reconciliation', 'urlFetch', 'kclNode']))
    expect(getSuggestions('gbifSearch')).toEqual(getSuggestions('gbifSearch', 'full'))
  })

  it('suggestion labels come from the sidebar registry', async () => {
    const { getSuggestions } = await import('../components/ConnectionSuggestions')
    const byType = Object.fromEntries(getSuggestions('gbifSearch', 'full').map(s => [s.type, s.label]))
    expect(byType.kclNode).toBe('AI Inference')
    expect(byType.kclField).toBe('AI Inference (by field)')
    expect(byType.filterTransform).toBe('Filter and Transform')
    expect(byType.timelineView).toBe('Timeline')
  })
})
