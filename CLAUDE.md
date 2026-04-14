# iDAH Federation Workflow PoC

A node-based visual workflow editor for federating UK Arts & Humanities research data services. Part of the UKRI/AHRC Federation of Compute and Infrastructures programme.

## Tech Stack

- **Frontend only** (no backend): React 19 + TypeScript + Vite
- **Node editor**: `@xyflow/react` (v12+). Import ONLY from `@xyflow/react`, NOT `reactflow` or `react-flow-renderer`.
- **No Service Worker**. Do not register any SW. No PWA plugin. No workbox.
- **Dev server port**: 5174 (fixed). Set in `vite.config.ts`.
- API calls happen **client-side** via `fetch()`. GBIF has permissive CORS. All other services (LLDS, ADS, MDS, Wikidata reconcile) are routed through **Vite dev proxy** rules in `vite.config.ts`.

## Development Philosophy

- **One increment at a time.** Each increment must be testable before moving to the next.
- **Console.log is the first output.** Before building UI for results, log them to the browser console.
- **No premature abstraction.** Don't build a generic adapter/orchestrator system until we have 2+ working data sources. Start concrete.

---

## Vite Proxy Rules (vite.config.ts)

All five proxies are live. Use the proxy path prefix in all frontend fetch calls:

| Prefix | Target | Reason |
|--------|--------|--------|
| `/llds-proxy/*` | `https://llds.ling-phil.ox.ac.uk/llds/*` | No CORS |
| `/ads-proxy/*` | `https://archaeologydataservice.ac.uk/*` | No CORS |
| `/mds-proxy/*` | `https://museumdata.uk/*` | No CORS |
| `/reconcile-proxy/*` | `https://wikidata.reconci.link/*` | 307 redirect strips CORS headers in browser |
| `/ollama/*` | `http://localhost:11434/*` | Avoids cross-port CORS for local Ollama |

The reconcile proxy is especially important: `wikidata.reconci.link` returns a 307 that strips CORS headers in the browser. The Vite proxy sidesteps the redirect entirely.

---

## Current Project Structure

```
nfcs-poc/
├── CLAUDE.md
├── README.md
├── package.json
├── vite.config.ts          # Dev server + all five CORS proxy rules
├── tsconfig.json
├── tsconfig.app.json       # lib includes DOM.AsyncIterable (File System Access API)
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx              # Canvas, sidebar, Run All button, node factories, templates, debug panel
    ├── index.css
    ├── types/
    │   └── UnifiedRecord.ts       # Canonical cross-service record type
    ├── hooks/
    │   └── useUpstreamRecords.ts  # Reactive multi-source merge hook
    ├── nodes/
    │   ├── index.ts               # nodeTypes registry for React Flow
    │   ├── ParamNode.tsx          # Text / Integer value node
    │   ├── GBIFSearchNode.tsx     # GBIF Occurrence API
    │   ├── LLDSSearchNode.tsx     # LLDS DSpace REST (with cache fallback)
    │   ├── ADSSearchNode.tsx      # ADS Data Catalogue API
    │   ├── MDSSearchNode.tsx      # Museum Data Service (HTML scraper)
    │   ├── LocalFolderSourceNode.tsx # File System Access API + fileReaders.ts
    │   ├── FilterTransformNode.tsx # Filter/transform processing node
    │   ├── SpatialFilterNode.tsx   # Leaflet bbox draw → filter by lat/lon
    │   ├── ReconciliationNode.tsx  # Wikidata reconciliation node
    │   ├── OllamaNode.tsx          # Local LLM via Ollama (streaming /api/chat)
    │   ├── ReconciledCell.tsx      # Shared universal cell renderer (see below)
    │   ├── TableOutputNode.tsx     # Paginated table output
    │   ├── JSONOutputNode.tsx      # Syntax-highlighted JSON viewer
    │   ├── MapOutputNode.tsx       # Leaflet map (lat/lon records)
    │   ├── TimelineOutputNode.tsx  # SVG horizontal timeline
    │   ├── ExportNode.tsx          # CSV / JSON / GeoJSON download
    │   └── ExpandedOutputPanel.tsx # Full-screen panel (double-click Table/JSON)
    └── utils/
        ├── fileReaders.ts          # FileRecord type + PDF/XML/text/image extraction
        ├── gbif.ts                 # buildGBIFUrl() + fetchGBIF()
        ├── gbifAdapter.ts          # GBIFSearchResponse → UnifiedRecord[]
        ├── lldsCache.ts            # localStorage cache helpers
        ├── llds.ts                 # LLDS fetch helpers
        ├── lldsAdapter.ts          # DSpaceItem → UnifiedRecord
        ├── adsAdapter.ts           # ADS JSON → UnifiedRecord
        ├── mds.ts                  # MDS fetch helpers
        ├── mdsAdapter.ts           # MDS HTML → UnifiedRecord
        ├── reconciliationService.ts # W3C Reconciliation API client + types
        ├── filterTransformUtils.ts  # Pure filter/transform functions
        ├── exportUtils.ts           # CSV / JSON / GeoJSON serialisers + download
        ├── runGBIFNode.ts           # NodeRunner for gbifSearch
        ├── runLLDSNode.ts           # NodeRunner for lldsSearch
        ├── runADSNode.ts            # NodeRunner for adsSearch
        ├── runMDSNode.ts            # NodeRunner for mdsSearch
        ├── runReconciliationNode.ts # NodeRunner for reconciliation
        ├── runFilterTransformNode.ts # NodeRunner for filterTransform
        ├── runSpatialFilterNode.ts  # NodeRunner for spatialFilter
        ├── nodeRunners.ts           # Registry: nodeType → NodeRunner
        └── runWorkflow.ts           # Topological executor (Kahn's algorithm)
```

---

## Node Types (all implemented and registered)

### Input
| Node type key | Component | Description |
|---------------|-----------|-------------|
| `param` | `ParamNode` | Holds a Text or Integer value; connects to search node input handles |

### Source
| Node type key | Component | Service | CORS |
|---------------|-----------|---------|------|
| `gbifSearch` | `GBIFSearchNode` | GBIF Occurrence API | Permissive (direct fetch) |
| `lldsSearch` | `LLDSSearchNode` | LLDS DSpace REST | `/llds-proxy` |
| `adsSearch` | `ADSSearchNode` | ADS Data Catalogue API | `/ads-proxy` |
| `mdsSearch` | `MDSSearchNode` | museumdata.uk (HTML scraper) | `/mds-proxy` |
| `localFolderSource` | `LocalFolderSourceNode` | Local filesystem via File System Access API | n/a — no runner; folder pick is a user gesture |

### Process
| Node type key | Component | Description |
|---------------|-----------|-------------|
| `filterTransform` | `FilterTransformNode` | Filter + transform records. Indigo `#4f46e5` header. |
| `spatialFilter` | `SpatialFilterNode` | Leaflet map with draw tool; keeps records within the drawn bbox. Cyan `#0891b2` header. |
| `reconciliation` | `ReconciliationNode` | Wikidata field reconciler. Violet `#7c3aed` header. |
| `ollamaNode` | `OllamaNode` | Streaming local LLM via Ollama `/api/chat`. Deep indigo `#312e81` header. No runner — streaming requires component-level state. |

### Output
| Node type key | Component | Description |
|---------------|-----------|-------------|
| `tableOutput` | `TableOutputNode` | Paginated table. Teal `#0d9488` header. Double-click to expand. Pass-through output handle (`id="results"`, `top: 13`). |
| `jsonOutput` | `JSONOutputNode` | Syntax-highlighted JSON viewer. Double-click to expand. |
| `mapOutput` | `MapOutputNode` | Leaflet map. Plots records with `decimalLatitude`/`decimalLongitude`. |
| `timelineOutput` | `TimelineOutputNode` | SVG timeline. Handles ISO dates, bare years, BCE dates (`-1199`). |
| `export` | `ExportNode` | Downloads CSV / JSON / GeoJSON. Amber `#b45309` header. |

---

## Registration Checklist (when adding a new runnable node)

1. Create `src/utils/run<Name>Node.ts` conforming to `NodeRunner` signature.
2. Import and add one line to `src/utils/nodeRunners.ts`.
3. Create `src/nodes/<Name>Node.tsx`.
4. Import and add one line to `src/nodes/index.ts`.
5. Add factory function to `NODE_DEFAULTS` in `src/App.tsx`.
6. Add sidebar entry to `SIDEBAR_ITEMS` in `src/App.tsx`.
7. Add typed data interface import + union to `AppNode` in `src/App.tsx`.
8. If service lacks permissive CORS, add proxy rule to `vite.config.ts`.

**Exception — nodes that cannot use a runner:** Some nodes must handle their own async logic in the component because they require direct user gestures (File System Access API) or maintain streaming state. These nodes skip steps 1–2 and are not included in `nodeRunners`. They are therefore excluded from **Run All**. Currently: `localFolderSource`, `ollamaNode`.

---

## Data Flow & Adapter Contract

- All adapters must return `UnifiedRecord[]` — output nodes never touch raw API responses.
- Service-specific fields live under a namespace: `record.gbif.*`, `record.llds.*`, `record.ads.*`, `record.mds.*`.
- After reconciliation, records gain `${fieldName}_reconciled` keys (see `ReconciliationResult` type).
- `useUpstreamRecords(nodeId)` merges `data.results` from **all** edges with `targetHandle === 'data'`, enabling multi-source aggregation automatically.

### NodeRunner contract

```typescript
export type NodeRunner = (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => Promise<void>
```

**Runners must NEVER throw.** They own their error handling and must always call `updateNodeData` to leave the node in a terminal status (`'success'` | `'cached'` | `'error'`) before returning. `runWorkflow.ts` will catch any rogue throws and mark the node as errored, but do not rely on this.

### Execution model

- **▶ Run** on individual source/process nodes — standalone execution.
- **▶▶ Run All** in top bar — `runWorkflow()` discovers all runnable nodes, builds topological order via Kahn's algorithm, executes source nodes in parallel first, then each processing layer in dependency order.

---

## UnifiedRecord Schema

```typescript
interface UnifiedRecord {
  id: string              // globally unique, service-prefixed: "gbif:12345", "ads:1862953"
  _source?:    string     // "gbif" | "llds" | "ads" | "mds"
  _sourceId?:  string | number
  _sourceUrl?: string     // link back to native UI
  _pid?:       string     // DOI, Handle, ARK
  _cached?:    boolean    // true when served from localStorage cache

  title?:       string
  description?: string
  creator?:     string | string[]
  date?:        string
  subject?:     string | string[]
  language?:    string
  type?:        string
  format?:      string

  // GBIF-specific
  scientificName?, country?, eventDate?
  decimalLatitude?, decimalLongitude?  // used by MapOutputNode
  basisOfRecord?, institutionCode?, datasetName?

  // Service namespace objects (excluded from column detection)
  gbif?: Record<string, unknown>
  llds?: Record<string, unknown>
  ads?:  Record<string, unknown>
  mds?:  Record<string, unknown>

  // Added by ReconciliationNode — detected by isReconciledValue()
  [fieldName_reconciled]: ReconciliationResult | null
}
```

---

## ReconciledCell.tsx — Universal Cell Renderer

**Location**: `src/nodes/ReconciledCell.tsx`

This is the single source of truth for rendering any table cell value. Import `renderCell` from here; do NOT write local `fmt()` functions or local reconciled-pill logic in output nodes.

```typescript
// Priority order:
export function renderCell(val: unknown): React.ReactNode {
  if (isReconciledValue(val)) return <ReconciledPill value={val} />  // green/amber QID pill
  if (isUrl(val)) return <ExternalLink href={val} />                  // clickable <a>
  if (Array.isArray(val)) { ... }                                     // comma-joined; URLs become links
  if (val === null || val === undefined) return '—'
  return String(val)
}
```

- `isUrl()`: detects `http://` or `https://` strings
- `ExternalLink`: `<a target="_blank" rel="noreferrer">` with `title` attribute and `onClick` stopPropagation
- `ReconciledPill`: green (`resolved`, confidence ≥ threshold) or amber (`review`) badge with clickable QID link to `wikidata.org`
- `isReconciledValue()`: **imported from `reconciliationService.ts`**, not redefined here

---

## reconciliationService.ts — Key Exports

**Location**: `src/utils/reconciliationService.ts`

| Export | Purpose |
|--------|---------|
| `isReconciledValue(v)` | Type guard — canonical location, imported everywhere |
| `ReconciliationResult` | Interface for `*_reconciled` field values |
| `AuthorityConfig` | Interface for reconciliation authority descriptors |
| `FIELD_AUTHORITY_MAP` | Record mapping field names to `AuthorityConfig[]` |
| `authoritiesForField(fieldName)` | Returns authority list for a field (falls back to `default`) |
| `candidateFields(record)` | Derives reconcilable field names from a sample record |
| `reconcileField(records, fieldName, authority, threshold)` | Batched POST to Wikidata Reconciliation API |

Important constants:
- `RECONCILE_API = '/reconcile-proxy/en/api'` — uses Vite proxy, not direct URL
- `MAX_BATCH = 200` — unique values cap per POST
- `TIMEOUT_MS = 20_000`

Shared authority groups (to avoid duplication in `FIELD_AUTHORITY_MAP`):
- `PLACE_AUTHORITIES` — Wikidata Places (Q618123) + GeoNames (coming soon)
- `TAXON_AUTHORITIES` — Wikidata Taxa (Q16521)
- `ITEM_AUTHORITIES` — Wikidata Items (no type filter)

---

## FilterTransformNode Types

**Location**: `src/nodes/FilterTransformNode.tsx` (exported types consumed by `filterTransformUtils.ts`)

```typescript
type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'isEmpty' | 'isNotEmpty' | 'greaterThan' | 'lessThan'
interface FilterOp   { id: string; field: string; operator: FilterOperator; value: string }

// TransformOp is a discriminated union — never partially merge/update; always replace the whole op
type TransformOp =
  | { type: 'rename';    id: string; field: string; newName: string; dropOriginal: boolean }
  | { type: 'extract';   id: string; field: string; newField: string; useRegex: boolean; regex: string; start: string; end: string }
  | { type: 'concat';    id: string; field1: string; field2: string; separator: string; newField: string }
  | { type: 'lowercase'; id: string; field: string }
  | { type: 'uppercase'; id: string; field: string }
  | { type: 'truncate';  id: string; field: string; maxLen: string }

type FTMode = 'filter' | 'transform' | 'both'
interface FilterTransformNodeData {
  mode: FTMode
  filterCombinator: 'AND' | 'OR'
  filterOps:    FilterOp[]
  transformOps: TransformOp[]
  status: string; statusMessage: string
  results?: UnifiedRecord[]; inputCount: number; outputCount: number
}
```

**CRITICAL**: When changing a `TransformOp`'s `type`, replace the entire op object (preserve only `id`). Do NOT merge/patch — the discriminated union fields will collide.

---

## Column Detection in Table Views

Both `TableOutputNode` and `ExpandedOutputPanel` use `allFlatColumns()`:

```typescript
function allFlatColumns(records: UnifiedRecord[]): string[] {
  const keys = new Set<string>()
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (v === null) continue
      // Include: primitives, arrays, and ReconciliationResult objects
      // Exclude: namespace objects (gbif, llds, ads, mds)
      if (typeof v !== 'object' || Array.isArray(v) || isReconciledValue(v)) keys.add(k)
    }
  }
  const ordered = DEFAULT_COLS.filter(c => keys.has(c))
  const extras  = [...keys].filter(k => !DEFAULT_COLS.includes(k)).sort()
  return [...ordered, ...extras]
}
```

The `isReconciledValue(v)` check is essential — without it, `*_reconciled` keys (which are objects) are excluded from column detection.

---

## TableOutputNode Pass-Through

`TableOutputNode` has both an input handle (`id="data"`, left) and a **pass-through output handle** (`id="results"`, right, positioned at `top: 13` to align with the header). This lets downstream nodes (MapOutputNode, TimelineOutputNode, ExportNode) read the merged/processed records from a table node rather than directly from source nodes.

Loop prevention: uses `useRef` comparing a string key of `${status}:${recordIds}` before calling `updateNodeData` — prevents infinite render loops since `useNodes()` fires on every `updateNodeData` call.

---

## ExportNode

**Location**: `src/nodes/ExportNode.tsx` + `src/utils/exportUtils.ts`

Formats: `csv`, `json`, `geojson`. Files named `nfcs-export-YYYY-MM-DD.{ext}`.

`exportUtils.ts` key functions:
- `flattenRecord(record)` — expands `*_reconciled` objects to `_qid`, `_label`, `_confidence`, `_status` columns; drops namespace objects (`gbif`, `llds`, `ads`, `mds`)
- `toCSV(records)` — flat table with proper comma/quote escaping
- `toJSON(records)` — full record graph, pretty-printed
- `toGeoJSON(records)` — `FeatureCollection` of records with `decimalLatitude` + `decimalLongitude` only

---

## GBIF API Reference

**Base URL**: `https://api.gbif.org/v1`
**Auth**: None. **CORS**: Permissive (direct browser fetch).

### Occurrence Search
`GET /occurrence/search`

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free text search |
| `scientificName` | string | Scientific name filter |
| `country` | string | ISO 3166-1 alpha-2 (e.g. `GB`) |
| `year` | string | Single year or range: `1990,2000` |
| `limit` | int | Max 300, default 20 |
| `offset` | int | Pagination offset |
| `hasCoordinate` | bool | Only records with lat/lon |

Response shape: `{ offset, limit, count, results: [{key, scientificName, decimalLatitude, decimalLongitude, country, eventDate, basisOfRecord, institutionCode, ...}] }`

NHM dataset key: `7e380070-f762-11e1-a439-00145eb45e9a`

---

## ADS Data Catalogue API Reference

**Base URL (via proxy)**: `/ads-proxy/data-catalogue-api/api/search`
**Auth**: None.

`GET /search?q={query}&size={size}&from={offset}`

Response: `{ total: { value }, hits: [{ id, data: { title, description, creator[], spatial[], temporal[], nativeSubject[], derivedSubject[], country[], originalId, issued, language, resourceType } }] }`

Record link: `https://archaeologydataservice.ac.uk/archsearch/record?titleId={originalId}`

UnifiedRecord mapping:
```
_source: "ads", _sourceId: data.originalId
title: data.title.text, description: data.description.text
creator: data.creator[].name (array)
date: data.issued, subject: nativeSubject + derivedSubject prefLabels
decimalLatitude/Longitude: data.spatial[0].geopoint.lat/lon
spatialCoverage: data.spatial[0].placeName
ads: { temporal, country, allSpatial, id }
```

---

## LLDS DSpace Reference

**Base URL (via proxy)**: `/llds-proxy/rest`
`GET /llds-proxy/rest/items?expand=metadata&limit={limit}`

Returns items with `metadata: [{key, value, language}]` arrays. No server-side search — filter client-side against `dc.title`, `dc.description`, `dc.subject`.

**Reliability**: Wraps fetch in 15s timeout; falls back to localStorage cache. Node exposes "use cache" checkbox (default on).

---

## MDS (museumdata.uk) Reference

**Base URL (via proxy)**: `/mds-proxy`

Two-step HTML scraper: probe for total count, then retrieve all records. Capped at 200 records; amber ⚠ badge when total exceeds cap.

---

## Wikidata Reconciliation API

**Endpoint (via proxy)**: `/reconcile-proxy/en/api`
**Protocol**: W3C Reconciliation API v0.2 — `POST` with `application/x-www-form-urlencoded`, body: `queries=<JSON>`

Query JSON shape:
```json
{
  "q0": { "query": "Quercus robur", "type": "Q16521", "limit": 3 },
  "q1": { "query": "Homo sapiens",  "type": "Q16521", "limit": 3 }
}
```

Response: `{ "q0": { "result": [{ "id": "Q23571040", "name": "Quercus robur", "score": 92, "match": true }] } }`

Scores are 0–100 from the API; normalised to 0–1 in `reconcileField()`.

---

## FileRecord — Local File Type

**Location**: `src/utils/fileReaders.ts`

A parallel type to `UnifiedRecord` used exclusively by `LocalFolderSourceNode` and `OllamaNode`. Not merged into `UnifiedRecord` — kept separate so the type contract remains clean.

```typescript
export interface FileRecord {
  id: string            // crypto.randomUUID()
  filename: string
  path: string          // relative path within selected folder
  contentType: 'text' | 'xml' | 'pdf_text' | 'image'
  content: string       // extracted text, or base64 data URL for images
  mimeType: string
  sizeBytes: number
  sourceFolder: string  // folder name from directory handle
}
```

Key exports:
- `extractFileContent(file, relativePath, folderName)` — dispatches by extension: `.txt/.md/.csv/.tsv` → `text`; `.xml/.html/.tei/.tei.xml` → `xml`; `.pdf` → `pdf_text` via pdfjs-dist; `.jpg/.png/.tiff/.webp` → `image` (base64 data URL)
- `scanDirectory(dirHandle, types, max)` — non-recursive iteration; `types` is an array of label strings (`'pdf'`, `'xml'`, `'text'`, `'image'`)
- pdfjs worker is loaded from CDN: `https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs` — avoids Vite bundler issues. Do not change this to a local import.
- `DOM.AsyncIterable` must be in `tsconfig.app.json` `lib` array for `for await...of` on `dirHandle.entries()`.

`TableOutputNode` renders `FileRecord` columns correctly via `allFlatColumns` (dynamic key enumeration). The `content` field for images is a long base64 string — it appears in the table but is truncated by cell overflow.

---

## OllamaNode — Local LLM

**Location**: `src/nodes/OllamaNode.tsx`

**Ollama API used**: `POST /ollama/api/chat` (via Vite proxy → `http://localhost:11434/api/chat`)

Model discovery: `GET /ollama/api/tags` on component mount → `response.models[].name` → dropdown.

Vision model detection: checks model name for `llava`, `vision`, `bakllava`, `moondream`, `cogvlm`. User can override with the **Vision model** checkbox (`visionOverride` in node data). The checkbox state takes precedence over name-based detection.

**Image handling (critical):**
- When `isVisionModel` is true AND a record has `contentType === 'image'`, the base64 data is stripped of its data URL prefix and sent as `images: [base64]` on the Ollama message object.
- `{{content}}` in the prompt template is replaced with `''` (empty string) for image records — do NOT pass the raw data URL as text; it is a multi-MB blob the model cannot interpret as text.

**Streaming:** Uses `stream: true` on `/api/chat`. Reads the response body as a `ReadableStream`, decodes newline-delimited JSON chunks, accumulates `chunk.message.content` deltas. Live preview shows the last 200 chars of the accumulation.

**Not in `nodeRunners`** — streaming requires component-level state; cannot be called from the topological executor.

Output fields added to each record: `ollamaModel`, `ollamaPrompt`, `ollamaResponse`, `ollamaProcessedAt`.

---

## Known Architectural Decisions & Gotchas

1. **`isReconciledValue` lives in `reconciliationService.ts`** — do not redefine it elsewhere.
2. **`renderCell` lives in `ReconciledCell.tsx`** — do not write local `fmt()` functions in output nodes.
3. **`RECONCILE_API` uses proxy path** — never change this to a direct `https://` URL.
4. **TransformOp type changes require full op replacement** — discriminated union; partial merge corrupts the object.
5. **TableOutputNode loop prevention** — `useRef` key comparison before `updateNodeData`; do not remove this.
6. **`allFlatColumns` must include `isReconciledValue` check** — without it, `*_reconciled` columns disappear.
7. **MDS is capped at 200** — by design; amber badge warns users.
8. **`useUpstreamRecords` merges by `targetHandle === 'data'`** — output handle id is `results` for pass-through.
9. **`LocalFolderSourceNode` stores `dirHandle` in a `useRef`** — not in node data (not serialisable). Re-scan reuses the ref. The handle is lost on page refresh; user must pick again.
10. **OllamaNode image prompt** — never put a raw base64 data URL into `{{content}}`; always blank it for image records and use the `images` field instead. See OllamaNode section above.
11. **pdfjs-dist worker must stay on CDN** — importing the worker locally causes Vite bundler/worker thread issues. The `workerSrc` string in `fileReaders.ts` uses `pdfjsLib.version` to stay in sync with the installed package version.
