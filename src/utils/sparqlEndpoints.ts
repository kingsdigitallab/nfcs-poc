/**
 * sparqlEndpoints — registry of SPARQL services the SparqlSearchNode can query.
 *
 * Wikidata is the full-featured endpoint (builder, mwapi keyword seed, NL
 * assist + entity grounding). Other endpoints run in Raw SPARQL mode only —
 * their vocabularies differ and the Wikidata-specific tooling would mislead.
 *
 * Every endpoint is reached through a same-origin proxy (server/proxies.mjs)
 * so requests carry a descriptive User-Agent and avoid CORS issues.
 */

export interface SparqlEndpointDef {
  id:    string
  label: string
  /** Same-origin proxy path the runner GETs with ?query=… */
  proxyPath: string
  /** Builder / NL assist / grounding / mwapi keyword are Wikidata-specific. */
  wikidataFeatures: boolean
  /** false → shown greyed-out in the endpoint dropdown. */
  available: boolean
  /** Tooltip, e.g. why an endpoint is unavailable. */
  note?: string
  /** Inserted into the raw editor when switching to this endpoint (only over
   *  an empty or builder-generated query — hand-written queries are kept). */
  sampleQuery?: string
  /** WDQS requires ?format=json; other endpoints content-negotiate via Accept. */
  formatParam?: boolean
  citation: { service: string; serviceUrl: string; publisher: string }
}

export const SPARQL_ENDPOINTS: SparqlEndpointDef[] = [
  {
    id:    'wikidata',
    label: 'Wikidata',
    proxyPath: '/wdqs-proxy/sparql',
    wikidataFeatures: true,
    available: true,
    formatParam: true,
    citation: {
      service:    'Wikidata Query Service',
      serviceUrl: 'https://query.wikidata.org',
      publisher:  'Wikimedia Foundation',
    },
  },
  {
    id:    'getty',
    label: 'Getty Vocabularies (AAT/TGN/ULAN)',
    // .json path: Getty content-negotiates /sparql on the Accept header, which
    // does not reliably survive the proxy hop (HTML editor page comes back);
    // /sparql.json returns sparql-results+json unconditionally (verified live).
    proxyPath: '/tgn-proxy/sparql.json',
    wikidataFeatures: false,
    available: true,
    note: 'Getty Art & Architecture Thesaurus, place names and artist names. Raw SPARQL only — gvp/xl/luc/skos prefixes are built in.',
    // Live-verified sample: AAT concepts matching a term, with English scope
    // notes. ?item/?itemLabel/?itemDescription follow the adapter conventions
    // (title/description); the node's limit row appends the LIMIT.
    sampleQuery: `SELECT ?item ?itemLabel ?itemDescription WHERE {
  ?item a skos:Concept ;
        luc:term "hillfort" ;
        skos:inScheme aat: ;
        gvp:prefLabelGVP/xl:literalForm ?itemLabel .
  OPTIONAL { ?item skos:scopeNote/rdf:value ?itemDescription .
             FILTER(LANG(?itemDescription) = "en") }
}`,
    citation: {
      service:    'Getty Vocabularies SPARQL',
      serviceUrl: 'https://vocab.getty.edu/sparql',
      publisher:  'J. Paul Getty Trust',
    },
  },
  {
    id:    'bl-bnb',
    label: 'British Library BNB',
    proxyPath: '/bnb-proxy/sparql',
    wikidataFeatures: false,
    // The BNB linked-data platform has been offline since the BL cyber-incident
    // (verified July 2026: DNS resolves, server never answers). The entry and
    // its proxy route are kept ready — flip `available` when BL restores it.
    available: false,
    note: 'Offline since the British Library cyber-incident — kept ready for when BL restores its linked-data service.',
    citation: {
      service:    'British National Bibliography (Linked Data)',
      serviceUrl: 'https://bnb.data.bl.uk',
      publisher:  'British Library',
    },
  },
]

export const DEFAULT_ENDPOINT = 'wikidata'

/** Endpoint definition by id, falling back to Wikidata for absent/unknown ids
 *  (old saved workflows carry no endpoint field). */
export function getEndpoint(id: string | undefined): SparqlEndpointDef {
  return SPARQL_ENDPOINTS.find(e => e.id === id) ?? SPARQL_ENDPOINTS[0]
}
