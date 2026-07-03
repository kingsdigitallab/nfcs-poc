/**
 * Pins the NL-assist grounding helpers: QID extraction (items only), safe
 * single-pass substitution, and the verify/replace/missing decision paths of
 * groundSparqlEntities (deps injected — no network).
 */
import { describe, it, expect } from 'vitest'
import { extractQids, substituteQids, groundSparqlEntities } from '../utils/sparqlEntityGround'
import type { EntitySuggestion, EntityLabel } from '../utils/wikidataApi'

const TURNER_SPARQL = `SELECT DISTINCT ?item ?itemLabel WHERE {
  ?item wdt:P31 wd:Q3305213 ;
        wdt:P170 wd:Q159758 .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`

describe('extractQids', () => {
  it('extracts unique wd:Q ids in order, ignoring wdt:P properties', () => {
    expect(extractQids(TURNER_SPARQL)).toEqual(['Q3305213', 'Q159758'])
  })

  it('deduplicates and respects word boundaries (Q42 vs Q423)', () => {
    const q = '?a wdt:P1 wd:Q42 . ?b wdt:P2 wd:Q423 . ?c wdt:P3 wd:Q42 .'
    expect(extractQids(q)).toEqual(['Q42', 'Q423'])
  })

  it('caps the number of extracted QIDs', () => {
    const q = Array.from({ length: 15 }, (_, i) => `?x wdt:P1 wd:Q${i + 1} .`).join('\n')
    expect(extractQids(q)).toHaveLength(10)
  })
})

describe('substituteQids', () => {
  it('replaces mapped QIDs without cascading ({Q1→Q2, Q2→Q3} in one pass)', () => {
    const out = substituteQids('wd:Q1 wd:Q2', { Q1: 'Q2', Q2: 'Q3' })
    expect(out).toBe('wd:Q2 wd:Q3')
  })

  it('never bleeds into longer QIDs (mapping Q15 must not touch Q159758)', () => {
    const out = substituteQids('wd:Q15 wd:Q159758', { Q15: 'Q99' })
    expect(out).toBe('wd:Q99 wd:Q159758')
  })

  it('returns the input untouched for an empty mapping', () => {
    expect(substituteQids(TURNER_SPARQL, {})).toBe(TURNER_SPARQL)
  })
})

// ── groundSparqlEntities with injected deps ───────────────────────────────────

function makeDeps(opts: {
  labels?: Record<string, EntityLabel>
  hits?: Record<string, EntitySuggestion[]>
  searchThrows?: boolean
  labelsThrow?: boolean
}) {
  return {
    labels: async (qids: string[]) => {
      if (opts.labelsThrow) throw new Error('network down')
      const m = new Map<string, EntityLabel>()
      for (const q of qids) if (opts.labels?.[q]) m.set(q, opts.labels[q])
      return m
    },
    search: async (name: string) => {
      if (opts.searchThrows) throw new Error('search down')
      return opts.hits?.[name] ?? []
    },
  }
}

describe('groundSparqlEntities', () => {
  it('verifies a correct QID via alias search (William Turner ≈ J. M. W. Turner)', async () => {
    const deps = makeDeps({
      labels: { Q3305213: { label: 'painting' }, Q159758: { label: 'J. M. W. Turner' } },
      hits: {
        'painting':       [{ id: 'Q3305213', label: 'painting' }],
        'William Turner': [
          { id: 'Q219831', label: 'William Turner of Oxford' },
          { id: 'Q159758', label: 'J. M. W. Turner' },        // alias hit, not top
        ],
      },
    })

    const { sparql, report } = await groundSparqlEntities(
      TURNER_SPARQL,
      { Q3305213: 'painting', Q159758: 'William Turner' },
      { deps },
    )

    expect(sparql).toBe(TURNER_SPARQL)   // nothing replaced
    expect(report.map(c => c.status)).toEqual(['ok', 'ok'])
    expect(report[1].actualLabel).toBe('J. M. W. Turner')
  })

  it('replaces a hallucinated QID with the top search hit for the declared name', async () => {
    const deps = makeDeps({
      labels: { Q3305213: { label: 'painting' } },            // Q99999 missing
      hits: {
        'painting':       [{ id: 'Q3305213', label: 'painting' }],
        'William Turner': [{ id: 'Q159758', label: 'J. M. W. Turner' }],
      },
    })
    const sparqlIn = TURNER_SPARQL.replace('Q159758', 'Q99999')

    const { sparql, report } = await groundSparqlEntities(
      sparqlIn,
      { Q3305213: 'painting', Q99999: 'William Turner' },
      { deps },
    )

    expect(sparql).toContain('wd:Q159758')
    expect(sparql).not.toContain('wd:Q99999')
    const replaced = report.find(c => c.qid === 'Q99999')!
    expect(replaced.status).toBe('replaced')
    expect(replaced.activeQid).toBe('Q159758')
    expect(replaced.replacedWith?.label).toBe('J. M. W. Turner')
  })

  it('replaces an existing-but-mismatched QID and keeps the original as an alternate', async () => {
    const deps = makeDeps({
      labels: { Q42: { label: 'Douglas Adams' } },
      hits: { 'England': [{ id: 'Q21', label: 'England' }] },  // Q42 not in hits → mismatch
    })

    const { sparql, report } = await groundSparqlEntities(
      '?x wdt:P17 wd:Q42 .',
      { Q42: 'England' },
      { deps },
    )

    expect(sparql).toBe('?x wdt:P17 wd:Q21 .')
    const check = report[0]
    expect(check.status).toBe('replaced')
    expect(check.actualLabel).toBe('Douglas Adams')
    // original QID included in alternates for one-click restore
    expect(check.alternates?.some(a => a.id === 'Q42')).toBe(true)
  })

  it('marks a hallucinated QID with no search hits as missing (query untouched)', async () => {
    const deps = makeDeps({ labels: {}, hits: {} })
    const { sparql, report } = await groundSparqlEntities('?x wdt:P31 wd:Q99999 .', { Q99999: 'flurbwidget' }, { deps })
    expect(sparql).toContain('wd:Q99999')
    expect(report[0].status).toBe('missing')
  })

  it('gives benefit of the doubt when search fails or no name was declared', async () => {
    // search throws → existing entity stays ok
    const throwing = makeDeps({ labels: { Q42: { label: 'Douglas Adams' } }, searchThrows: true })
    const r1 = await groundSparqlEntities('?x wdt:P50 wd:Q42 .', { Q42: 'England' }, { deps: throwing })
    expect(r1.report[0].status).toBe('ok')

    // no declared name → existence check only, label surfaced for human review
    const noName = makeDeps({ labels: { Q42: { label: 'Douglas Adams' } } })
    const r2 = await groundSparqlEntities('?x wdt:P50 wd:Q42 .', {}, { deps: noName })
    expect(r2.report[0].status).toBe('ok')
    expect(r2.report[0].actualLabel).toBe('Douglas Adams')
  })

  it('rethrows when the initial label fetch fails (caller keeps the raw query)', async () => {
    const deps = makeDeps({ labelsThrow: true })
    await expect(groundSparqlEntities(TURNER_SPARQL, {}, { deps })).rejects.toThrow('network down')
  })

  it('returns the query untouched when it contains no wd:Q references', async () => {
    const deps = makeDeps({})
    const { sparql, report } = await groundSparqlEntities('SELECT * WHERE { ?s ?p ?o }', {}, { deps })
    expect(sparql).toBe('SELECT * WHERE { ?s ?p ?o }')
    expect(report).toEqual([])
  })
})
