/**
 * Runner for SparqlSearchNode — executes the node's SPARQL query against the
 * Wikidata Query Service via /wdqs-proxy (WDQS needs a descriptive
 * User-Agent, which the proxy adds). Wikidata-only this pass; other
 * endpoints (e.g. British Library) are a follow-up once verified live.
 *
 * The query text lives in node.data.sparqlQuery (written raw, or generated
 * by the builder UI). A wired/inline limit is appended as a LIMIT clause
 * only when the query has none — an explicit LIMIT in the query wins.
 */
import type { NodeRunner } from './nodeRunners'
import { clearNodeResults, setNodeResults } from '../store/resultsStore'
import { adaptSparqlResults, type SparqlResultsJson } from './sparqlAdapter'
import { addCitation } from './citationUtils'
import { fetchWithTimeout } from './fetchWithTimeout'
import { resolveLimit, finishRunnerError } from './runnerHelpers'

const WDQS_ENDPOINT = '/wdqs-proxy/sparql'
const HAS_LIMIT = /\bLIMIT\s+\d+\s*$/i

export const runSparqlNode: NodeRunner = async (nodeId, getNodes, edges, updateNodeData) => {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as Record<string, unknown>

  const rawQuery = ((d.sparqlQuery as string | undefined) ?? '').trim()
  if (!rawQuery) {
    updateNodeData(nodeId, { status: 'error', statusMessage: '✗ No SPARQL query', count: 0 })
    return
  }

  const limit = resolveLimit(nodeId, nodes, edges, d.inlineLimit as string | undefined)
  const query = HAS_LIMIT.test(rawQuery) ? rawQuery : `${rawQuery}\nLIMIT ${limit}`

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Querying WDQS…', count: 0 })

  try {
    const url = `${WDQS_ENDPOINT}?query=${encodeURIComponent(query)}&format=json`
    // WDQS can legitimately take tens of seconds on broad queries.
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/sparql-results+json' } }, 60_000)
    if (!res.ok) throw new Error(`WDQS HTTP ${res.status} ${res.statusText}`)
    const json = await res.json() as SparqlResultsJson

    const records = adaptSparqlResults(json)
    const cited = addCitation(records as unknown as Record<string, unknown>[], {
      service:    'Wikidata Query Service',
      serviceUrl: 'https://query.wikidata.org',
      publisher:  'Wikimedia Foundation',
      accessDate: new Date().toISOString(),
      query:      (d.inlineQuery as string | undefined)?.trim() || 'SPARQL query',
    })

    const version = setNodeResults(nodeId, cited)
    updateNodeData(nodeId, {
      status:         'success',
      // WDQS reports no total — the result set is the whole answer (post-LIMIT).
      statusMessage:  `✓ ${records.length.toLocaleString()} results`,
      count:          records.length,
      resultsVersion: version,
    })
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[SPARQL]')
  }
}
