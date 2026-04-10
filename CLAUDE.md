# iDAH Federation Workflow PoC

A node-based visual workflow editor for federating UK Arts & Humanities research data services. Part of the UKRI/AHRC Federation of Compute and Infrastructures programme.

## Tech Stack

- **Frontend only** (no backend for now): React + TypeScript + Vite
- **Node editor**: `@xyflow/react` (v12+). Import from `@xyflow/react`, NOT `reactflow` or `react-flow-renderer`.
- **No Service Worker**. Do not register any SW. No PWA plugin. No workbox.
- **Dev server port**: 5174 (not default 5173, to avoid conflicts). Set in `vite.config.ts`:
  ```ts
  export default defineConfig({
    server: { port: 5174 },
    plugins: [react()]
  })
  ```
- API calls happen **client-side** via `fetch()` directly from the browser. GBIF has permissive CORS headers so no proxy is needed. Services without permissive CORS (LLDS, ADS) are routed through **Vite dev proxy** rules in `vite.config.ts`. In production these would be replaced by a real lightweight proxy (e.g. a Cloudflare Worker or a single Express route per service).

## Development Philosophy

- **One increment at a time.** Each increment must be testable before moving to the next.
- **Console.log is the first output.** Before building UI for results, log them to the browser console so we can verify the API call works.
- **No premature abstraction.** Don't build a generic adapter/orchestrator system until we have 2+ working data sources. Start concrete.

---

## GBIF API Reference (primary data source for MVP)

**Base URL**: `https://api.gbif.org/v1`
**Auth**: None required. CORS: permissive (browser fetch works directly).
**Docs**: https://techdocs.gbif.org/en/openapi/

### Occurrence Search
`GET /occurrence/search`

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free text search across all fields |
| `scientificName` | string | Scientific name filter |
| `country` | string | ISO 3166-1 alpha-2 country code (e.g. `GB`) |
| `year` | string | Single year or range: `1990` or `1990,2000` |
| `basisOfRecord` | string | `PRESERVED_SPECIMEN`, `HUMAN_OBSERVATION`, `FOSSIL_SPECIMEN`, etc. |
| `geometry` | string | WKT geometry for spatial filter |
| `datasetKey` | string | Filter by dataset UUID |
| `limit` | int | Results per page (max 300, default 20) |
| `offset` | int | Pagination offset |
| `hasCoordinate` | bool | Only records with lat/lon |

**Response** (JSON):
```json
{
  "offset": 0,
  "limit": 20,
  "count": 54321,
  "results": [
    {
      "key": 12345,
      "scientificName": "Quercus robur L.",
      "decimalLatitude": 51.75,
      "decimalLongitude": -1.25,
      "country": "GB",
      "eventDate": "2019-06-15",
      "basisOfRecord": "PRESERVED_SPECIMEN",
      "institutionCode": "NHM",
      "datasetKey": "...",
      "species": "Quercus robur",
      "genus": "Quercus",
      "family": "Fagaceae"
    }
  ]
}
```

### Species Match
`GET /species/match?name={name}`

Returns best match with `usageKey` (GBIF taxon ID), `scientificName`, `rank`, `confidence`, `status`.

### NHM Dataset Key
To filter GBIF results to NHM specimens only: `datasetKey=7e380070-f762-11e1-a439-00145eb45e9a`

---

## ADS Data Catalogue API Reference (Archaeology Data Service)

**Base URL**: `https://archaeologydataservice.ac.uk/data-catalogue-api/api`
**Auth**: None. **CORS**: No permissive headers — uses Vite dev proxy.

Dev proxy rule in `vite.config.ts`:
```ts
'/ads-proxy': {
  target: 'https://archaeologydataservice.ac.uk',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/ads-proxy/, ''),
}
```
Use `/ads-proxy/data-catalogue-api/api/search` in frontend code.

### Search
`GET /search?q={query}`

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free text search |
| `size` | int | Results per page (default 20) |
| `from` | int | Pagination offset |

**Response** (JSON):
```json
{
  "total": { "value": 29, "relation": "eq" },
  "hits": [
    {
      "id": "hash_string",
      "data": {
        "title": { "text": "STIFFKEY", "language": "en" },
        "description": { "text": "...", "language": "en" },
        "creator": [{ "name": "Historic England" }],
        "spatial": [{ "placeName": "England, NORFOLK, NORTH NORFOLK, STIFFKEY", "geopoint": { "lat": 52.94, "lon": 0.92 } }],
        "temporal": [{ "from": "-1199", "periodName": "late bronze age", "until": "-0699" }],
        "nativeSubject": [{ "prefLabel": "geophysical survey" }],
        "derivedSubject": [{ "prefLabel": "pits (earthworks)", "source": "Getty AAT" }],
        "country": [{ "id": "http://www.wikidata.org/entity/Q21", "name": "England" }],
        "originalId": "1862953",
        "issued": "2020-06-08",
        "language": "en",
        "resourceType": "dataset"
      }
    }
  ]
}
```

Record links resolve via `originalId`:
`https://archaeologydataservice.ac.uk/archsearch/record?titleId={originalId}`

### UnifiedRecord mapping for ADS
```
_source:         "ads"
_sourceId:       hit.data.originalId
_sourceUrl:      https://archaeologydataservice.ac.uk/archsearch/record?titleId={originalId}
title:           hit.data.title.text
description:     hit.data.description.text
creator:         hit.data.creator[].name (array)
date:            hit.data.issued
subject:         merged nativeSubject[].prefLabel + derivedSubject[].prefLabel
language:        hit.data.language
type:            hit.data.resourceType
decimalLatitude: hit.data.spatial[0].geopoint.lat
decimalLongitude:hit.data.spatial[0].geopoint.lon
spatialCoverage: hit.data.spatial[0].placeName
ads:             { temporal, country, allSpatial, id } — full namespace fields
```

---

## ADS OAI-PMH Reference (Archaeology Data Service)

**Protocol**: OAI-PMH 2.0 (returns XML, not JSON)
**Auth**: None. **CORS**: Unlikely to be permissive — will need a Vite dev proxy like LLDS.

Three separate endpoints, one per collection:
- Archives: `https://archaeologydataservice.ac.uk/oai/archives`
- Library: `https://archaeologydataservice.ac.uk/oai/library`
- OASIS: `https://archaeologydataservice.ac.uk/oai/oasis`

Dev proxy rule in `vite.config.ts`:
```ts
'/ads-proxy': {
  target: 'https://archaeologydataservice.ac.uk',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/ads-proxy/, ''),
}
```
Use `/ads-proxy/oai/archives` etc. in the frontend code.

### Servlet path
The OAI-PMH servlet is at `{base}/OAIHandler` and requires **POST** with `application/x-www-form-urlencoded` body. A GET to `{base}` redirects to an HTML landing page — do not use GET.

Example: `POST https://archaeologydataservice.ac.uk/oai/archives/OAIHandler` with body `verb=ListRecords&metadataPrefix=oai_dc`

### ListRecords
`POST {base}/OAIHandler` with body `verb=ListRecords&metadataPrefix=oai_dc`

Optional body params: `from` (YYYY-MM-DD), `until` (YYYY-MM-DD), `set` (sub-collection).

**No keyword search exists in OAI-PMH.** To search, harvest a batch of records and filter client-side.

Response is XML. Each record contains Dublin Core metadata:
```xml
<record>
  <header>
    <identifier>oai:archaeologydataservice.ac.uk:archives/1234</identifier>
    <datestamp>2024-01-15</datestamp>
  </header>
  <metadata>
    <oai_dc:dc>
      <dc:title>Excavations at Stonehenge</dc:title>
      <dc:creator>Smith, J.</dc:creator>
      <dc:subject>Archaeology</dc:subject>
      <dc:description>Report on excavations...</dc:description>
      <dc:date>2023</dc:date>
      <dc:identifier>https://doi.org/10.5284/...</dc:identifier>
      <dc:coverage>Wiltshire</dc:coverage>
      <dc:language>en</dc:language>
    </oai_dc:dc>
  </metadata>
</record>
```

Use `getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')` etc. for namespace-safe extraction via `DOMParser` in the browser.

### Resumption tokens
Large result sets are paginated. The response includes:
```xml
<resumptionToken>token_string_here</resumptionToken>
```
Fetch next page: `GET {base}?verb=ListRecords&resumptionToken=token_string_here`

Implement a `maxPages` cap (default 3) to prevent runaway harvesting.

### UnifiedRecord mapping for ADS
```
_source:    "ads"
_sourceId:  <header><identifier> text content
_sourceUrl: first http/https value in <dc:identifier> elements
_pid:       first https://doi.org value in <dc:identifier> elements
title:      <dc:title>
description:<dc:description>
creator:    all <dc:creator> values as array
date:       <dc:date>
subject:    all <dc:subject> values as array
language:   <dc:language>
type:       <dc:type>
format:     <dc:format>
ads:        { endpoint, identifier, coverage, rights, … } — full raw fields
```

---

## LLDS DSpace Reference (Literary and Linguistic Data Service)

**Protocol**: DSpace REST API (returns JSON)
**Auth**: None. **CORS**: No permissive headers — uses Vite dev proxy.

Dev proxy rule in `vite.config.ts`:
```ts
'/llds-proxy': {
  target: 'https://llds.ling-phil.ox.ac.uk',
  changeOrigin: true,
  rewrite: path => path.replace(/^\/llds-proxy/, '/llds'),
}
```

**Base URL (via proxy)**: `/llds-proxy/rest`

### Items endpoint
`GET /llds-proxy/rest/items?expand=metadata&limit={limit}`

Returns all items with Dublin Core metadata arrays. No server-side keyword search — filter client-side against `dc.title`, `dc.description`, and `dc.subject`.

Each item's metadata is an array of `{"key": "dc.title", "value": "...", "language": "..."}` objects.

**Reliability note**: LLDS has experienced multi-week outages. The adapter wraps the fetch in a 15-second timeout and falls back to a localStorage cache on any failure. The node exposes a "use cache" checkbox (default on) to control this.

---

## Node Types (implemented)

### Source Nodes
| Node | Service | Auth | CORS |
|------|---------|------|------|
| `GBIFSearchNode` | GBIF Occurrence API | None | Permissive |
| `LLDSSearchNode` | LLDS DSpace REST | None | Via proxy |
| `ADSSearchNode` | ADS Data Catalogue API | None | Via proxy |

### Output Nodes
| Node | Behaviour |
|------|-----------|
| `TableOutputNode` | Paginated table, auto-detects columns, supports multiple input sources merged |
| `JSONOutputNode` | Syntax-highlighted JSON viewer, preview/show-all toggle |

### Input Nodes
| Node | Behaviour |
|------|-----------|
| `ParamNode` | Holds a Text or Integer value, connects to source node input handles |

---

## Data Flow & Adapter Contract

All adapters (`gbifAdapter.ts`, `lldsAdapter.ts`, `adsAdapter.ts`) must return `UnifiedRecord[]`.
Output nodes **only** consume `UnifiedRecord[]` — they never handle raw API responses.
Service-specific fields live under a namespace: `record.gbif.*`, `record.llds.*`, `record.ads.*`.

The `useUpstreamRecords` hook merges records from **all** edges connected to an output node's
`data` input handle, enabling multi-source tables automatically.

### Execution model
- **Run All** button in the top bar calls `runWorkflow()` which executes all runnable nodes
  in topological order (source nodes first, processing nodes after their deps).
- Each source node also has its own **Run** button for standalone execution.
- Node runners are registered in `src/utils/nodeRunners.ts` — the only file to update when
  adding a new runnable node type.

---

## Project Structure

```
nfcs-poc/
├── CLAUDE.md
├── package.json
├── vite.config.ts          # Dev server + CORS proxy rules for LLDS, ADS
├── tsconfig.json
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx              # Canvas, sidebar, Run All button, node factories
    ├── index.css
    ├── types/
    │   └── UnifiedRecord.ts # Canonical cross-service record type
    ├── hooks/
    │   └── useUpstreamRecords.ts  # Reactive multi-source data hook
    ├── nodes/
    │   ├── index.ts               # nodeTypes registry for React Flow
    │   ├── ParamNode.tsx
    │   ├── GBIFSearchNode.tsx
    │   ├── LLDSSearchNode.tsx
    │   ├── ADSSearchNode.tsx
    │   ├── TableOutputNode.tsx
    │   ├── JSONOutputNode.tsx
    │   └── ExpandedOutputPanel.tsx
    └── utils/
        ├── gbif.ts           # buildGBIFUrl() + fetchGBIF()
        ├── gbifAdapter.ts    # GBIFSearchResponse → UnifiedRecord[]
        ├── lldsCache.ts      # localStorage cache helpers
        ├── lldsAdapter.ts    # DSpaceItem → UnifiedRecord
        ├── runLLDSNode.ts    # NodeRunner for lldsSearch
        ├── adsAdapter.ts     # ADS Data Catalogue JSON → UnifiedRecord
        ├── runADSNode.ts     # NodeRunner for adsSearch
        ├── runGBIFNode.ts    # NodeRunner for gbifSearch
        ├── nodeRunners.ts    # Registry: nodeType → NodeRunner
        └── runWorkflow.ts    # Topological executor
```

Single Vite project. No monorepo. No backend. No Docker.
