/**
 * Pins the SPARQL endpoint registry: ids are unique and stable (they are
 * serialised into .nfcs.json), Wikidata stays present/available/default, and
 * every entry carries the fields the runner and node UI depend on.
 */
import { describe, it, expect } from 'vitest'
import { SPARQL_ENDPOINTS, DEFAULT_ENDPOINT, getEndpoint } from '../utils/sparqlEndpoints'

describe('SPARQL endpoint registry', () => {
  it('has unique, stable ids including wikidata', () => {
    const ids = SPARQL_ENDPOINTS.map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('wikidata')
    expect(ids).toContain('getty')
    expect(ids).toContain('bl-bnb')
  })

  it('wikidata is the available, full-featured default', () => {
    const wd = getEndpoint('wikidata')
    expect(wd.available).toBe(true)
    expect(wd.wikidataFeatures).toBe(true)
    expect(wd.proxyPath).toBe('/wdqs-proxy/sparql')
    expect(DEFAULT_ENDPOINT).toBe('wikidata')
  })

  it('falls back to wikidata for absent/unknown ids (old saved workflows)', () => {
    expect(getEndpoint(undefined).id).toBe('wikidata')
    expect(getEndpoint('nonsense').id).toBe('wikidata')
  })

  it('every endpoint has a proxy path and a full citation', () => {
    for (const ep of SPARQL_ENDPOINTS) {
      expect(ep.proxyPath).toMatch(/^\/[a-z-]+\/sparql(\.json)?$/)
      expect(ep.citation.service).toBeTruthy()
      expect(ep.citation.serviceUrl).toMatch(/^https:\/\//)
      expect(ep.citation.publisher).toBeTruthy()
    }
  })

  it('non-Wikidata endpoints are raw-only; unavailable ones carry a note', () => {
    for (const ep of SPARQL_ENDPOINTS) {
      if (ep.id !== 'wikidata') expect(ep.wikidataFeatures).toBe(false)
      if (!ep.available) expect(ep.note).toBeTruthy()
    }
    // Getty is live and ships a sample query for the raw editor
    expect(getEndpoint('getty').available).toBe(true)
    expect(getEndpoint('getty').sampleQuery).toContain('skos:Concept')
  })
})
