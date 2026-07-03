/**
 * Runner for SparqlSearchNode — executes the node's SPARQL query against the
 * endpoint selected on the node (node.data.endpoint, default Wikidata). Each
 * endpoint is reached through its same-origin proxy (see sparqlEndpoints.ts),
 * which adds the descriptive User-Agent services like WDQS require.
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
import { getEndpoint } from './sparqlEndpoints'

const HAS_LIMIT = /\bLIMIT\s+\d+\s*$/i

/**
 * SPARQL services return verbose Java stack traces (often HTML-wrapped) on a
 * 400, e.g. a bad prefix or malformed query. Pull out the most informative
 * line and cap the length so the node's status badge stays readable instead
 * of dumping the trace.
 */
function extractSparqlError(body: string): string {
  const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const m = text.match(
    /(MalformedQueryException|QueryParseException|Lexical error|Encountered[^;]*|Unknown prefix[^;]*|not a valid[^;]*|QName[^;]*)/i,
  )
  const pick = (m ? m[0] : text).trim()
  return pick.length > 200 ? `${pick.slice(0, 199)}…` : pick
}

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

  const endpoint = getEndpoint(d.endpoint as string | undefined)
  const limit = resolveLimit(nodeId, nodes, edges, d.inlineLimit as string | undefined)
  const query = HAS_LIMIT.test(rawQuery) ? rawQuery : `${rawQuery}\nLIMIT ${limit}`

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: `Querying ${endpoint.label}…`, count: 0 })

  try {
    // WDQS requires ?format=json; other endpoints content-negotiate via Accept.
    const format = endpoint.formatParam ? '&format=json' : ''
    const url = `${endpoint.proxyPath}?query=${encodeURIComponent(query)}${format}`
    // SPARQL services can legitimately take tens of seconds on broad queries.
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/sparql-results+json' } }, 60_000)
    if (!res.ok) {
      let detail = ''
      try { detail = extractSparqlError(await res.text()) } catch { /* body unreadable — fall back to status */ }
      throw new Error(`${endpoint.label} ${res.status}${detail ? `: ${detail}` : ` ${res.statusText}`}`)
    }
    const json = await res.json() as SparqlResultsJson

    const records = adaptSparqlResults(json)
    const cited = addCitation(records as unknown as Record<string, unknown>[], {
      ...endpoint.citation,
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
