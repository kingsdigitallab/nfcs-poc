# iDAH Federation Workflow PoC

Node-based visual workflow editor for federating UK Arts & Humanities research data services (UKRI/AHRC).

## Tech Stack

- **Frontend only**: React 19 + TypeScript + Vite, port **5174**
- **Node editor**: `@xyflow/react` (v12+) — import ONLY from `@xyflow/react`
- **No Service Worker / PWA / workbox**
- API calls client-side via `fetch()`. GBIF: direct. All others: Vite dev proxy.

## Vite Proxy Rules (`vite.config.ts`)

| Prefix | Target |
|--------|--------|
| `/llds-proxy/*` | `https://llds.ling-phil.ox.ac.uk/llds/*` |
| `/ads-proxy/*` | `https://archaeologydataservice.ac.uk/*` |
| `/mds-proxy/*` | `https://museumdata.uk/*` |
| `/reconcile-proxy/*` | `https://wikidata.reconci.link/*` (307 redirect strips CORS — proxy required) |
| `/ollama/*` | `http://localhost:11434/*` |
| `/url-proxy?url=<encoded>[&js=true][&wait=<strategy>]` | Custom Vite middleware (`configureServer`); simple path uses Node `fetch()`; `js=true` uses Puppeteer singleton (auto-reset on `disconnected`). Wait strategies: `networkidle2` (default), `networkidle0`, `domcontentloaded`. |
| `/ads-library-search?q=<query>&size=<n>` | Custom Vite middleware; two-step JSF session (GET ViewState → POST search) for the ADS Library catalogue. Returns extracted CDATA HTML for client-side parsing. |

## Project Structure

```
src/
├── App.tsx              # Canvas, collapsible sidebar, Run All, node factories, save/load
├── types/UnifiedRecord.ts
├── store/resultsStore.ts        # Out-of-band Map store + version counter
├── hooks/useUpstreamRecords.ts  # Merges records from all data-handle edges
├── nodes/               # One file per node + index.ts registry
└── utils/
    ├── nodeRunners.ts           # Registry: nodeType → NodeRunner
    ├── runWorkflow.ts           # Topological executor (Kahn's algorithm)
    ├── workflowIO.ts            # downloadWorkflow / parseWorkflowFile / hydrateNodes
    ├── nodeIdCounter.ts         # newId(prefix) + bumpCounterPast(ids[])
    ├── resultsStore.ts → store/
    ├── reconciliationService.ts # isReconciledValue (canonical), reconcileField, FIELD_AUTHORITY_MAP
    ├── filterTransformUtils.ts
    ├── exportUtils.ts           # flattenRecord, toCSV/JSON/GeoJSON
    ├── fileReaders.ts           # FileRecord + PDF/XML/text/image extraction
    └── run<Name>Node.ts         # One runner per runnable node type
```

## Node Registry

### Canvas / Input
| Key | Component | Notes |
|-----|-----------|-------|
| `comment` | `CommentNode` | No handles. `NodeResizer`. Factory sets `style: {width:220,height:120}`. |
| `param` | `ParamNode` | Text or Integer value; connects to search handles. |

### Search
| Key | Component | CORS |
|-----|-----------|------|
| `gbifSearch` | `GBIFSearchNode` | Direct. `https://api.gbif.org/v1/occurrence/search`. Max 300/req. |
| `lldsSearch` | `LLDSSearchNode` | `/llds-proxy/rest/items?expand=metadata`. No server search — filter client-side. 15s timeout → localStorage cache fallback. |
| `adsSearchAdvanced` | `ADSSearchAdvancedNode` | `/ads-proxy/…/search`. **Server hard-caps at 50**; `fetchAll` loop. Facet filters: ariadneSubject, derivedSubject, nativeSubject, country, dataType, temporal. |
| `adsLibrarySearch` | `ADSLibraryNode` | `/ads-library-search` Vite middleware. Two-step JSF: GET ViewState → POST query → parse CDATA HTML. Returns title, creator, date, publicationType, parentTitle, downloadUrl. |
| `mdsSearch` | `MDSSearchNode` | `/mds-proxy`. Two-step HTML scraper. Capped at 200 (amber badge). |
| `localFolderSource` | `LocalFolderSourceNode` | File System Access API — no runner (user gesture required). `dirHandle` in `useRef`, lost on refresh. |

### Process
| Key | Component | Header |
|-----|-----------|--------|
| `filterTransform` | `FilterTransformNode` | `#4f46e5`. `TransformOp` is a discriminated union — **always replace full op on type change**. |
| `spatialFilter` | `SpatialFilterNode` | `#0891b2`. Leaflet draw → bbox filter. |
| `reconciliation` | `ReconciliationNode` | `#7c3aed`. Uses `/reconcile-proxy/en/api`. Scores normalised 0–1. |
| `ollamaNode` | `OllamaNode` | `#312e81`. `stream:true` on `/ollama/api/chat`. Vision: strip data URL prefix, use `images:[]` field, blank `{{content}}`. `tokenInput` state from `d.maxTokens` directly (TDZ gotcha). |
| `ollamaField` | `OllamaFieldNode` | `#1e1b4b`. Per-record or aggregate mode. Templates: `{{value}}`, `{{field}}`, `{{count}}`, `{{values}}`. Same TDZ gotcha as OllamaNode. |
| `urlFetch` | `URLFetchNode` | `#0c4a6e`. Adds `fetchedContent`, `fetchedHtml` (cleaned body), `fetchStatus`, `fetchedAt`. AbortController cancel. URL field picker scans namespace sub-objects; runner resolves dot-notation field paths (e.g. `adsLibrary.downloadUrl`). |
| `htmlSection` | `HTMLSectionNode` | `#065f46`. CSS selector on `fetchedHtml` → overwrites `fetchedContent`. Adds `htmlSelector`. |

### Output
| Key | Component | Notes |
|-----|-----------|-------|
| `tableOutput` | `TableOutputNode` | `#0d9488`. Pass-through output handle `id="results"` at `top:13`. Loop prevention via `useRef` fingerprint. Double-click expands. Toolbar: **show all columns** + **expand namespaces** (flattens one level of namespace objects into dot-notation cols). |
| `jsonOutput` | `JSONOutputNode` | Double-click expands. |
| `mapOutput` | `MapOutputNode` | Uses `decimalLatitude`/`decimalLongitude`. |
| `timelineOutput` | `TimelineOutputNode` | ISO dates, bare years, BCE (`-1199`). |
| `export` | `ExportNode` | `#b45309`. CSV/JSON/GeoJSON. `flattenRecord` expands `*_reconciled` to `_qid/_label/_confidence/_status` cols. |
| `ollamaOutput` | `OllamaOutputNode` | `#0f172a`. Reads `ollamaResponse`. No pass-through. |
| `quickView` | `QuickViewNode` | `#1e293b`. No handles, no runner. Full-value inspector with record nav. |

## Registration Checklist (new runnable node)

1. `src/utils/run<Name>Node.ts` — implement `NodeRunner`
2. Add to `src/utils/nodeRunners.ts`
3. `src/nodes/<Name>Node.tsx`
4. Add to `src/nodes/index.ts`
5. Factory in `NODE_DEFAULTS` (`App.tsx`)
6. Sidebar entry in `SIDEBAR_ITEMS` (`App.tsx`)
7. Data interface + union in `AppNode` (`App.tsx`)
8. Proxy rule in `vite.config.ts` if needed

**Exceptions:** `localFolderSource` (user gesture) skips 1–2. `quickView`, `comment` (display-only) skip 1–2 and have no handles.

## Results Store — CRITICAL

**Never put record arrays in `updateNodeData`** — causes O(n) re-renders across all `useNodes()` subscribers.

Use `src/store/resultsStore.ts`:
- `setNodeResults(nodeId, records)` → returns version int
- `getNodeResults(nodeId)` → records
- `clearNodeResults(nodeId)`

Runner pattern: `clearNodeResults` first → do work → `setNodeResults` → `updateNodeData({ …, resultsVersion: version })`. The version integer is the reactivity signal; `useUpstreamRecords` reads it and fetches from the store.

## NodeRunner Contract

```typescript
type NodeRunner = (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => Promise<void>
```

- **Never throw** — always leave node in `'success'` | `'cached'` | `'error'` status.
- Batch runners (`ollamaNode`, `ollamaField`, `urlFetch`) wrap each record in `try/catch`; call `setNodeResults` after each record for partial results.

## Data Flow

- All adapters → `UnifiedRecord[]`. Service fields namespaced: `record.gbif.*`, `record.ads.*`, etc.
- `useUpstreamRecords(nodeId)` merges all edges where `targetHandle === 'data'`.
- `TableOutputNode` pass-through uses `targetHandle === 'results'`.
- Reconciled fields: `${field}_reconciled` containing `ReconciliationResult | null`.

## Key Utilities

- **`renderCell`** in `ReconciledCell.tsx` — sole cell renderer. Do not write local `fmt()` in output nodes.
- **`isReconciledValue`** in `reconciliationService.ts` — sole location. Do not redefine.
- **`allFlatColumns`** in `TableOutputNode` — must include `isReconciledValue(v)` check or `*_reconciled` columns vanish.
- **`newId(prefix)`** / **`bumpCounterPast(ids[])`** in `nodeIdCounter.ts` — call `bumpCounterPast` after workflow load.
- **`TRANSIENT_FIELDS`** in `workflowIO.ts` strips `results`, `status`, counts, `resultsVersion`, `_capped`, `_total`, `folderName` before save.

## Architectural Gotchas

1. `RECONCILE_API = '/reconcile-proxy/en/api'` — never use direct URL.
2. `TransformOp` discriminated union — replace entire op on type change; never patch.
3. `TableOutputNode` fingerprint `useRef` — prevents infinite loop; do not remove.
4. `allFlatColumns` needs `isReconciledValue` check — else reconciled columns excluded.
5. MDS capped at 200, ADS server hard-caps at 50 — both by design.
6. `LocalFolderSourceNode` `dirHandle` in `useRef` — lost on page refresh.
7. OllamaNode vision: never put base64 data URL in `{{content}}`; use `images:[]` and blank the content substitution.
8. pdfjs worker must stay on CDN (`unpkg.com/pdfjs-dist@{version}/build/pdf.worker.min.mjs`) — local import breaks Vite.
9. Ollama `tokenInput` state — initialise from `d.maxTokens` directly; TDZ crash if referencing a later `const`.
10. Ollama runners use `stream:true` — `stream:false` generates exactly `num_predict` tokens regardless of natural stop.
11. Puppeteer singleton: `_browserPromise = null` in `disconnected` handler — do not remove.
12. `bumpCounterPast(loadedIds)` after workflow load — prevents ID collisions.
13. `CommentNode` size via `style: {width, height}` on node object, not `data`.
14. `fetchedHtml` is cleaned body HTML — `HTMLSectionNode` reads this, not raw response.
