/**
 * sparqlEntityGround — verify and auto-repair the Wikidata entity references
 * (wd:Q…) in an LLM-generated SPARQL query.
 *
 * LLMs hallucinate QIDs: "paintings by william turner" produces syntactically
 * valid SPARQL with a wrong/invented QID → zero rows, no explanation. The NL
 * assist therefore asks the model to declare what each QID it used is meant to
 * be (an `entities` map), and this module grounds those claims against live
 * Wikidata:
 *
 *   - entity does not exist            → hallucinated; replace from live search
 *   - entity exists, name declared     → verified iff the QID appears in the
 *     top-N wbsearchentities(declaredName) hits — the server matches ALIASES,
 *     so "William Turner" correctly verifies Q159758 (label "J. M. W. Turner");
 *     no fragile string similarity involved
 *   - verification impossible (search error / empty hits / no declared name)
 *     → benefit of the doubt, report the real label for human review
 *
 * All helpers are pure or dependency-injected for testability. Grounding is
 * tolerant by design — a network failure rethrows only from the initial label
 * fetch; callers keep the original query in that case.
 */
import {
  searchEntities as liveSearch,
  fetchEntityLabels as liveLabels,
  type EntitySuggestion,
} from './wikidataApi'

export interface EntityCheck {
  /** QID as originally emitted by the model. */
  qid:          string
  /** QID currently in the query (= qid, or the replacement). */
  activeQid:    string
  /** What the model said this QID means, from the `entities` map. */
  declaredName?: string
  /** Real Wikidata label; undefined when the entity does not exist. */
  actualLabel?:  string
  status:       'ok' | 'replaced' | 'missing'
  replacedWith?: EntitySuggestion
  /** Live-search hits for declaredName — the user's alternates picker. */
  alternates?:  EntitySuggestion[]
}

export interface GroundingDeps {
  search: typeof liveSearch
  labels: typeof liveLabels
}

/** Distinct wd:Q… items in order of appearance. Never matches wdt:P…/p:/ps:.
 *  Capped to keep grounding cheap on pathological queries. */
export function extractQids(sparql: string, cap = 10): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of sparql.matchAll(/\bwd:(Q\d+)\b/g)) {
    const qid = m[1].toUpperCase()
    if (seen.has(qid)) continue
    seen.add(qid)
    out.push(qid)
    if (out.length >= cap) break
  }
  return out
}

/**
 * Replace wd:Q… references per `mapping` in a SINGLE pass — a mapping like
 * {Q1→Q2, Q2→Q3} cannot cascade, and the \b boundaries mean Q15 never bleeds
 * into Q159758.
 */
export function substituteQids(sparql: string, mapping: Record<string, string>): string {
  if (Object.keys(mapping).length === 0) return sparql
  return sparql.replace(/\bwd:(Q\d+)\b/g, (whole, qid: string) => {
    const to = mapping[qid.toUpperCase()]
    return to ? `wd:${to}` : whole
  })
}

const SEARCH_LIMIT = 8

/**
 * Ground every wd:Q… in `sparql` against Wikidata, auto-substituting
 * hallucinated/mismatched QIDs with the top live-search hit for the model's
 * declared entity name. Returns the (possibly rewritten) query + a per-entity
 * report. Throws only if the initial label fetch fails — per-entity search
 * errors degrade to `ok` (benefit of the doubt).
 */
export async function groundSparqlEntities(
  sparql: string,
  declared: Record<string, string>,
  opts: { signal?: AbortSignal; deps?: Partial<GroundingDeps> } = {},
): Promise<{ sparql: string; report: EntityCheck[] }> {
  const search = opts.deps?.search ?? liveSearch
  const labels = opts.deps?.labels ?? liveLabels

  const qids = extractQids(sparql)
  if (qids.length === 0) return { sparql, report: [] }

  // Throws on network failure — the caller keeps the raw query, no report.
  const labelMap = await labels(qids)

  // Normalise declared-name keys to uppercase QIDs.
  const declaredByQid: Record<string, string> = {}
  for (const [k, v] of Object.entries(declared)) {
    if (/^Q\d+$/i.test(k) && typeof v === 'string' && v.trim()) declaredByQid[k.toUpperCase()] = v.trim()
  }

  const report: EntityCheck[] = []
  const mapping: Record<string, string> = {}

  await Promise.all(qids.map(async qid => {
    const actual   = labelMap.get(qid)
    const declaredName = declaredByQid[qid]
    const exists   = actual !== undefined

    if (exists && !declaredName) {
      // Nothing to verify against — show the real label for human review.
      report.push({ qid, activeQid: qid, actualLabel: actual.label, status: 'ok' })
      return
    }

    let hits: EntitySuggestion[] = []
    if (declaredName) {
      try {
        hits = await search(declaredName, { limit: SEARCH_LIMIT, signal: opts.signal })
      } catch {
        hits = []   // verification impossible — do not punish the query
      }
    }

    if (exists) {
      const verified = hits.length === 0 || hits.some(h => h.id.toUpperCase() === qid)
      if (verified) {
        report.push({ qid, activeQid: qid, declaredName, actualLabel: actual.label, status: 'ok' })
      } else {
        // Exists but is NOT what the model claimed — swap in the top hit;
        // keep the original in the alternates for one-click restore.
        const top = hits[0]
        mapping[qid] = top.id
        report.push({
          qid, activeQid: top.id, declaredName, actualLabel: actual.label,
          status: 'replaced', replacedWith: top,
          alternates: [...hits, { id: qid, label: actual.label, description: 'original (model choice)' }],
        })
      }
      return
    }

    // Entity does not exist — hallucinated.
    if (hits.length > 0) {
      const top = hits[0]
      mapping[qid] = top.id
      report.push({
        qid, activeQid: top.id, declaredName,
        status: 'replaced', replacedWith: top, alternates: hits,
      })
    } else {
      report.push({ qid, activeQid: qid, declaredName, status: 'missing' })
    }
  }))

  // Promise.all resolution order is nondeterministic — restore query order.
  const order = new Map(qids.map((q, i) => [q, i]))
  report.sort((a, b) => (order.get(a.qid) ?? 0) - (order.get(b.qid) ?? 0))

  return { sparql: substituteQids(sparql, mapping), report }
}
