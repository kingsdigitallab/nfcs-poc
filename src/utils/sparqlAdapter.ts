/**
 * sparqlAdapter — maps SPARQL JSON results (application/sparql-results+json)
 * to UnifiedRecord[]. Wikidata-shaped conventions:
 *
 * - `?item`            entity URI → `_sourceUrl`/`_pid`; trailing Q-id → `_qid`
 *                      (WikidataEnrich and MergeByQID read `_qid`) and the
 *                      record id `sparql:Q…-{row}`.
 * - `?itemLabel`       → `title`;  `?itemDescription` → `description`.
 * - WKT point literals (`Point(lon lat)`, e.g. wdt:P625 coordinates) in ANY
 *   binding → `decimalLatitude`/`decimalLongitude`.
 * - `?date` (or the first xsd:dateTime binding) → `date` (ISO, date part).
 * - Every binding's plain value is preserved under `sparql.<var>`.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

export interface SparqlBindingValue {
  type: string            // 'uri' | 'literal' | 'bnode'
  value: string
  datatype?: string
  'xml:lang'?: string
}

export interface SparqlResultsJson {
  head?:    { vars?: string[] }
  results?: { bindings?: Array<Record<string, SparqlBindingValue>> }
}

const WKT_POINT   = /^Point\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/i
const ENTITY_QID  = /\/(Q\d+)$/
const XSD_DATETIME = 'http://www.w3.org/2001/XMLSchema#dateTime'

export function adaptSparqlResults(json: SparqlResultsJson): UnifiedRecord[] {
  const bindings = json.results?.bindings ?? []
  return bindings.map((row, i) => {
    const sparqlNs: Record<string, unknown> = {}
    let qid: string | undefined
    let itemUri: string | undefined
    let lat: number | null = null
    let lon: number | null = null
    let date: string | undefined

    for (const [varName, b] of Object.entries(row)) {
      if (!b || typeof b.value !== 'string') continue
      sparqlNs[varName] = b.value

      if (varName === 'item' && b.type === 'uri') {
        itemUri = b.value
        qid = ENTITY_QID.exec(b.value)?.[1]
      }
      const wkt = WKT_POINT.exec(b.value)
      if (wkt && lat === null) {
        lon = parseFloat(wkt[1])
        lat = parseFloat(wkt[2])
      }
      if (date === undefined && (varName === 'date' || b.datatype === XSD_DATETIME)) {
        date = b.value.slice(0, 10)   // ISO date part
      }
    }

    const label       = typeof row.itemLabel?.value === 'string' ? row.itemLabel.value : undefined
    const description = typeof row.itemDescription?.value === 'string' ? row.itemDescription.value : undefined

    const rec: UnifiedRecord = {
      // Row index keeps ids unique — a query can return the same entity in
      // several rows with different bindings.
      id:          `sparql:${qid ?? 'row'}-${i}`,
      _source:     'sparql',
      title:       label ?? qid ?? `SPARQL result ${i + 1}`,
      sparql:      sparqlNs,
    }
    if (description)      rec.description = description
    if (itemUri)          { rec._sourceUrl = itemUri; rec._pid = itemUri }
    if (qid)              rec._qid = qid
    if (lat !== null)     { rec.decimalLatitude = lat; rec.decimalLongitude = lon }
    if (date)             rec.date = date
    return rec
  })
}
