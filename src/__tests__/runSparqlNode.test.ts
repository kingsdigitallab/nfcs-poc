/**
 * Pins the SPARQL runner's endpoint resolution: the node's `endpoint` field
 * selects the proxy path (absent = Wikidata, so old saves are unaffected),
 * ?format=json is WDQS-specific, LIMIT is appended only when missing, and an
 * error body is condensed to a readable message.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { runSparqlNode } from '../utils/runSparqlNode'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

const EMPTY_RESULTS = { head: { vars: [] }, results: { bindings: [] } }

function sparqlNode(data: Record<string, unknown>): Node {
  return { id: 'sq1', type: 'sparqlSearch', position: { x: 0, y: 0 }, data }
}

async function run(data: Record<string, unknown>) {
  const node = sparqlNode(data)
  const updates: Record<string, unknown>[] = []
  await runSparqlNode('sq1', () => [node], [] as Edge[], (_id, d) => updates.push(d))
  return updates
}

describe('runSparqlNode endpoint resolution', () => {
  it('defaults to the Wikidata proxy with format=json (old saves have no endpoint field)', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(EMPTY_RESULTS), { status: 200 }))

    await run({ sparqlQuery: 'SELECT * WHERE { ?s ?p ?o }', inlineLimit: '5' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith('/wdqs-proxy/sparql?query=')).toBe(true)
    expect(url).toContain('format=json')
    // LIMIT appended from the limit row when the query has none
    expect(decodeURIComponent(url)).toContain('LIMIT 5')
  })

  it('routes endpoint:"getty" through /tgn-proxy without format=json', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(EMPTY_RESULTS), { status: 200 }))

    await run({ endpoint: 'getty', sparqlQuery: 'SELECT * WHERE { ?s ?p ?o } LIMIT 3' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith('/tgn-proxy/sparql.json?query=')).toBe(true)
    expect(url).not.toContain('format=json')
    // explicit LIMIT in the query wins — nothing appended
    expect((decodeURIComponent(url).match(/LIMIT/g) ?? [])).toHaveLength(1)
  })

  it('condenses an error body into a readable status message naming the endpoint', async () => {
    fetchMock.mockResolvedValueOnce(new Response(
      '<html>java.util.concurrent.ExecutionException: MalformedQueryException: Lexical error at line 3, encountered "desc" garbage garbage stack trace continues forever</html>',
      { status: 400 },
    ))

    const updates = await run({ sparqlQuery: 'SELECT * WHERE { ?s ?p ?o }' })

    const err = updates.find(u => u.status === 'error')!
    expect(String(err.statusMessage)).toContain('Wikidata 400')
    expect(String(err.statusMessage)).toContain('MalformedQueryException')
    expect(String(err.statusMessage).length).toBeLessThan(280)
  })
})
