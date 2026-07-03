/**
 * sparqlQueryBuilder — deterministic Wikidata SPARQL generation from the
 * SparqlSearchNode builder state (task-SQ.2). No LLM involved; the optional
 * NL assist (task-SQ.3) writes raw queries instead.
 *
 * Generated shape (LIMIT deliberately absent — the runner appends the node's
 * limit row when the query has none):
 *
 *   SELECT DISTINCT ?item ?itemLabel ?itemDescription ?<col…> WHERE {
 *     <mwapi keyword seed, when a keyword is set>
 *     ?item wdt:P31[/wdt:P279*] wd:<class> .
 *     <one triple or CONTAINS filter per property filter row>
 *     OPTIONAL { ?item wdt:<col> ?<var> . }        # per output column
 *     SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
 *   }
 */
import { PROPERTY_FIELD_NAMES } from './wikidataApi'

export interface SparqlBuilderFilter {
  id:       string
  /** Wikidata property id, e.g. 'P170' */
  property: string
  /** 'Q…' → exact entity match; any other text → CONTAINS filter on the
   *  value's string form (works for literal-valued properties; use a Q-id
   *  for entity-valued ones) */
  value:    string
}

export interface SparqlBuilderState {
  /** Free-text seed — becomes a wikibase:mwapi EntitySearch service call */
  keyword?:    string
  /** instance-of class Q-id */
  instanceOf?: string
  /** widen instance-of to subclasses (wdt:P31/wdt:P279*) */
  subclasses?: boolean
  filters?:    SparqlBuilderFilter[]
  /** extra output columns as property ids (each becomes an OPTIONAL + SELECT var) */
  columns?:    string[]
}

const QID = /^Q\d+$/i
const PID = /^P\d+$/i

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** SELECT var name for a column property — the curated field name when known. */
export function columnVar(pid: string): string {
  return PROPERTY_FIELD_NAMES[pid.toUpperCase()] ?? pid.toLowerCase()
}

/**
 * Returns the generated query, or '' when the state constrains nothing
 * (an unconstrained ?item would scan all of Wikidata).
 */
export function buildSparqlQuery(state: SparqlBuilderState): string {
  const body: string[] = []

  const keyword = state.keyword?.trim()
  if (keyword) {
    body.push(
      `  SERVICE wikibase:mwapi {`,
      `    bd:serviceParam wikibase:endpoint "www.wikidata.org";`,
      `                    wikibase:api "EntitySearch";`,
      `                    mwapi:search "${escapeLiteral(keyword)}";`,
      `                    mwapi:language "en".`,
      `    ?item wikibase:apiOutputItem mwapi:item.`,
      `  }`,
    )
  }

  const instanceOf = state.instanceOf?.trim().toUpperCase()
  if (instanceOf && QID.test(instanceOf)) {
    const path = state.subclasses ? 'wdt:P31/wdt:P279*' : 'wdt:P31'
    body.push(`  ?item ${path} wd:${instanceOf} .`)
  }

  let filterVar = 0
  for (const f of state.filters ?? []) {
    const prop  = f.property?.trim().toUpperCase()
    const value = f.value?.trim()
    if (!prop || !PID.test(prop) || !value) continue
    if (QID.test(value)) {
      body.push(`  ?item wdt:${prop} wd:${value.toUpperCase()} .`)
    } else {
      filterVar += 1
      const v = `?f${filterVar}`
      body.push(
        `  ?item wdt:${prop} ${v} .`,
        `  FILTER(CONTAINS(LCASE(STR(${v})), "${escapeLiteral(value.toLowerCase())}"))`,
      )
    }
  }

  if (body.length === 0) return ''   // nothing constrains ?item

  const selectVars = ['?item', '?itemLabel', '?itemDescription']
  const seen = new Set<string>()
  for (const pid of state.columns ?? []) {
    const prop = pid.trim().toUpperCase()
    if (!PID.test(prop) || seen.has(prop)) continue
    seen.add(prop)
    const v = `?${columnVar(prop)}`
    selectVars.push(v)
    body.push(`  OPTIONAL { ?item wdt:${prop} ${v} . }`)
  }

  body.push(`  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }`)

  return `SELECT DISTINCT ${selectVars.join(' ')} WHERE {\n${body.join('\n')}\n}`
}

/** Factory default: paintings by J. M. W. Turner with date/coords/image columns. */
export const DEFAULT_BUILDER_STATE: SparqlBuilderState = {
  instanceOf: 'Q3305213',                                     // painting
  subclasses: false,
  filters:    [{ id: 'f-default', property: 'P170', value: 'Q159758' }],  // creator: Turner
  columns:    ['P571', 'P625', 'P18'],                        // inception, coordinates, image
}

/** Curated instance-of suggestions for the builder datalist (humanities-leaning). */
export const INSTANCE_CLASS_SUGGESTIONS: Array<{ qid: string; label: string }> = [
  { qid: 'Q5',        label: 'human' },
  { qid: 'Q3305213',  label: 'painting' },
  { qid: 'Q87167',    label: 'manuscript' },
  { qid: 'Q571',      label: 'book' },
  { qid: 'Q839954',   label: 'archaeological site' },
  { qid: 'Q4989906',  label: 'monument' },
  { qid: 'Q33506',    label: 'museum' },
  { qid: 'Q16970',    label: 'church building' },
  { qid: 'Q23413',    label: 'castle' },
  { qid: 'Q93184',    label: 'drawing' },
  { qid: 'Q860861',   label: 'sculpture' },
  { qid: 'Q1004',     label: 'comics' },
  { qid: 'Q7725634',  label: 'literary work' },
  { qid: 'Q11424',    label: 'film' },
  { qid: 'Q1030034',  label: 'earthwork' },
]
