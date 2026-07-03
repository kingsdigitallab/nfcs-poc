# iDAH Federation Workflow PoC

Node-based visual workflow editor for federating UK Arts & Humanities research data services (UKRI/AHRC).

## Tech Stack

- **Frontend only**: React 19 + TypeScript + Vite, port **5174**
- **Node editor**: `@xyflow/react` (v12+) — import ONLY from `@xyflow/react`
- **No Service Worker / PWA / workbox**
- API calls client-side via `fetch()`. GBIF: direct. All others: same-origin proxy.

## Tests & Typecheck

`npx vitest run` (config in `vite.config.ts`, include `src/**/*.test.{ts,tsx}`, jsdom) and `npm run build` (`tsc -b && vite build`) must BOTH stay green — the typecheck was repaired in refactor-v3 after a long period of drift; do not let it rot again. `UnifiedRecord` carries an `[key: string]: unknown` index signature by design (records are open — enrichment nodes add undeclared fields); adapter-output conformance is enforced at runtime by the fixture test, not the compiler. Test suites live in `src/__tests__/`:
utility unit tests, plus `workflowIO.test.ts` (save/load round-trip), `runWorkflow.test.ts` (Kahn wave ordering + failure
skipping, mocks `nodeRunners`), and `fixtureConformance.test.ts` — reads every `public/fixtures/*.json` from disk and asserts
records conform to `UnifiedRecord` (its `ALLOWED_TOP_LEVEL` list must be kept in sync with the interface).

## Run Modes

| Command | Server | Port |
|---------|--------|------|
| `npm run dev` | Vite dev server (hot-reload) | **5174** |
| `docker compose up` | Express (`server/index.mjs`) | **3001** |

Both modes expose identical proxy endpoints and custom middleware — the single source of truth is **`server/proxies.mjs`**, imported by both `vite.config.ts` (dev) and `server/index.mjs` (prod). `server/proxies.mjs` is plain ESM by design so Node can execute it directly in-container without a build step.

**Adding a new data source:**
- Simple reverse-proxy → add an entry to `PROXY_TABLE` in `server/proxies.mjs`
- Custom middleware → export a new connect-style function from `server/proxies.mjs` and wire it into both `vite.config.ts` (under `configureServer`) and `server/index.mjs` (under `app.use`)

## Proxy Rules (`server/proxies.mjs`)

| Prefix | Target |
|--------|--------|
| `/llds-proxy/*` | `https://llds.ling-phil.ox.ac.uk/llds/*` |
| `/ads-proxy/*` | `https://archaeologydataservice.ac.uk/*` |
| `/mds-proxy/*` | `https://museumdata.uk/*` |
| `/reconcile-proxy/*` | `https://wikidata.reconci.link/*` (307 redirect strips CORS — proxy required) |
| `/kcl-proxy/*` | `https://api.ai.create.kcl.ac.uk/*` (KCL OpenAI-compatible inference API) |
| `/ollama/*` | `$OLLAMA_HOST` (default `http://localhost:11434`) |
| `/bodleian-proxy/*` | `https://digital.bodleian.ox.ac.uk/*` |
| `/smg-proxy/*` | `https://collection.sciencemuseumgroup.org.uk/*` |
| `/vam-proxy/*` | `https://api.vam.ac.uk/*` |
| `/tgn-proxy/*` | `https://vocab.getty.edu/*` |
| `/getty-search-proxy/*` | `https://www.getty.edu/*` |
| `/nominatim-proxy/*` | `https://nominatim.openstreetmap.org/*` |
| `/hsds-proxy/*` | `https://hsds.ac.uk/*` |
| `/wdqs-proxy/*` | `https://query.wikidata.org/*` (SPARQL; proxy adds the descriptive User-Agent WDQS requires + Accept sparql-results+json) |
| `/url-proxy?url=<encoded>[&js=true][&wait=<strategy>]` | Custom middleware; simple path uses Node `fetch()`; `js=true` uses Puppeteer singleton (auto-reset on `disconnected`). Wait strategies: `networkidle2` (default), `networkidle0`, `domcontentloaded`. |
| `/ads-library-search?q=<query>&size=<n>` | Custom middleware; two-step JSF session (GET ViewState → POST search) for the ADS Library catalogue. Returns extracted CDATA HTML for client-side parsing. |
| `/ads-catalogue-search?<qs>` | Custom middleware; Cloudflare bypass via warmed Puppeteer page holding `cf_clearance`. |
| `/llds-search?q=<query>&rpp=<n>` | Custom middleware; Puppeteer solves Anubis JS proof-of-work challenge. |

## KCL Inference Configuration (`src/utils/kclConfig.ts`)

**Model-dependent content truncation:**
```ts
MODEL_CHAR_LIMITS = {
  'arc:nano':  12_000,   // small model — conservative limit
  'arc:lite':  32_000,   // mid-tier
  'arc:nexus': 64_000,   // large model
  'arc:apex':  64_000,   // apex — same as nexus for safety
}
```

Use `getContentMaxChars(model: string): number` to get the per-model limit. Applied in both runners and components. In KCLFieldNode aggregate mode, per-value truncation is applied **before** concatenation to prevent oversized payloads.

**Streaming in KCLFieldNode (component path only):**
- `kclChat(..., onToken?: (token: string) => void)` — if `onToken` is provided, `stream: true`; otherwise `stream: false`.
- Streaming parser accumulates tokens via SSE (`data: {...}\n\n` format), firing `onToken` callback for live UI preview.
- Returns full accumulated text (not empty string) so callers can store the response in results.
- Runner (`runKCLFieldNode.ts`) stays non-streaming; partial results achieved via per-record `setNodeResults` calls.

**Prompt recipes (`src/hooks/usePromptRecipes.ts`):**
- Built-in recipes for standard and field-mode nodes (per-record and aggregate variants).
- User recipes stored in `localStorage` with versioning (`nfcs_prompt_recipes` + `nfcs_prompt_recipes_version`).
- Hook exported: `usePromptRecipes() → { recipes, saveRecipe, deleteRecipe }`.

## Project Structure

```
src/
├── App.tsx              # Canvas shell + state wiring only (~250 lines) — feature logic lives in hooks/ + components/
├── components/
│   ├── TopBar.tsx               # Title, save/load, notes, grouping, mode toggles, Run All (author-mode + example dialog internal)
│   ├── Sidebar.tsx              # Node palette: search, collapsible TaDiRAH groups, Experimental section
│   └── …                        # ChatSidebar (takes nodes/edges as props — no ReactFlowProvider
│                                # exists, so RF hooks don't work there; appends a live CURRENT
│                                # CANVAS lineage section to the system prompt per send),
│                                # ConnectionSuggestions, modals, …
├── hooks/
│   ├── useWorkflowIO.ts         # save/applyWorkflow/load + workflowId + loadError
│   ├── useGrouping.ts           # group/ungroup + auto-resize effect (debounce/tolerance comments preserved)
│   ├── useCanvasConnections.ts  # onConnect/onDrop/onConnectEnd, SINGLETON_TARGET_HANDLES, suggestion + handle-picker popups
│   └── useUpstreamRecords.ts    # merges records from all data-handle edges
├── config/
│   ├── storageKeys.ts           # STORAGE_KEYS — all localStorage key constants
│   ├── sidebarItems.ts          # SIDEBAR_ITEMS, SIDEBAR_GROUPS, DEFAULT_COLLAPSED_GROUPS,
│   │                            # ADVANCED_TYPES — single source of truth for the sidebar
│   └── nodeDefaults.ts          # NODE_DEFAULTS factory record, KCL_API_KEY_NODES, findSharedApiKey
├── styles/
│   └── appStyles.ts             # React.CSSProperties constants for App.tsx layout
├── types/
│   ├── UnifiedRecord.ts         # Canonical inter-node data contract (schema.org annotated).
│   │                            # Domain-specific GBIF fields live ONLY under gbif.* — no flat copies.
│   │                            # periodStart/End/Name stay top-level (cross-service: ADS/ARIADNE/HSDS).
│   └── AppNode.ts               # AppNode union type + inline *NodeData interfaces
├── store/resultsStore.ts        # Out-of-band Map store + version counter
├── nodes/               # One file per node + index.ts registry (+ NodeTypeId)
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

Sidebar groups follow **TaDiRAH 2.0** terminology (cross-referenced in `src/components/TADIRAHMapping.tsx`).
Group labels are UI-only — **node `type` strings (e.g. `'gbifSearch'`) are serialised into `.nfcs.json`
and must never be renamed.**

### Workflow Planning (Canvas primitives)
| Key | Component | Notes |
|-----|-----------|-------|
| `quickStart` | `QuickStartNode` | AI workflow planner — describe a research question in plain English, KCL (arc:nexus) proposes search nodes + comments + SourceProfile/TableOutput/MapOutput; "Instantiate workflow" places them all. Requires KCL API key. |
| `comment` | `CommentNode` | No handles. `NodeResizer`. Factory sets `style: {width:220,height:120}`. |
| `param` | `ParamNode` | Text or Integer value; connects to search handles. |

### Discovering (TaDiRAH: Capture > Discovering)
| Key | Component | CORS |
|-----|-----------|------|
| `gbifSearch` | `GBIFSearchNode` | Direct. `https://api.gbif.org/v1/occurrence/search`. Max 300/req. |
| `lldsSearch` | `LLDSSearchNode` | `/llds-proxy/rest/items?expand=metadata`. No server search — filter client-side. 15s timeout → localStorage cache fallback. Thin config over `BackboneSearchNode` (useCache footer toggle). |
| `ariadneSearch` | `ARIADNESearchNode` | Direct CORS fetch. Pan-European archaeology portal (40+ institutions, 23 countries). Filters: Resource type, Getty AAT subject, Native subject, Country, Data type, Period, Contributor (set Contributor = "Archaeology Data Service" for ADS records). |
| `hsdsSearch` | `HSDSSearchNode` | Vite proxy, no Cloudflare. Heritage Science Data Service — UK heritage aggregator (Historic England, HES, Cadw). Same filter set as ARIADNESearch plus Country = England/Scotland/Wales/Northern Ireland. `hsds.*` namespace. |
| `bodleianSearch` | `BodleianSearchNode` | `/bodleian-proxy/*`. Oxford Bodleian Digital Collections. Filters: date range, language, origins, completeness, musical notation. `bodleian.manifest` → feeds ImageView (IIIF mode). Fixture mode supported. Thin config over `BackboneSearchNode` (single-select sort, fq* filters). |
| `europeanaSearch` | `EuropeanaSearchNode` | Pre-configured API key (overridable via Param → apiKey handle). Cursor pagination up to 1,000 records. Adds `europeana.thumbnail`, `europeana.shownAt`, `europeana.rights`. |
| `smgSearch` | `SMGSearchNode` | `/smg-proxy/*`. Science Museum Group collection. `smg.manifest` (IIIF) → ImageView. Fixture mode supported. Thin config over `BackboneSearchNode` (searchType body row switches endpoint). |
| `vaSearch` | `VASearchNode` | `/vam-proxy/*`. V&A collection (API v2). Filters: images only, object type, year made from/to. `vam.manifest`, `vam.iiifImageBase`, `vam.thumbnail`. Thin config over `BackboneSearchNode`. |
| `adsSearchAdvanced` | `ADSSearchAdvancedNode` | **DEPRECATED — blocked by Cloudflare.** Use ARIADNESearch (Contributor = "Archaeology Data Service") or HSDSSearch instead. |
| `adsLibrarySearch` | `ADSLibraryNode` | **DEPRECATED — blocked by Cloudflare**, same as above. |
| `mdsSearch` | `MDSSearchNode` | `/mds-proxy`. Two-step HTML scraper. Capped at 200 (amber status text). Thin config over `BackboneSearchNode`. |

### Gathering (TaDiRAH: Capture > Gathering)
| Key | Component | Notes |
|-----|-----------|-------|
| `localFolderSource` | `LocalFolderSourceNode` | File System Access API — no runner (user gesture required). `dirHandle` in `useRef`, lost on refresh. 5 typed output handles: `results` (all), `pdf`, `xml`, `text`, `image`; partitioned store keys `${id}:pdf` etc. |
| `localFileSource` | `LocalFileSourceNode` | No runner. `fileMode: 'csv' \| 'xml' \| 'image'`. CSV → column-keyed rows; xml/image → single `FileRecord` via `extractFileContent`. |
| `sampleDataSource` | `SampleDataSourceNode` | **Has a runner — participates in Run All** (unlike LocalFolderSource/LocalFileSource). Loads pre-packaged collection files from `public/fixtures/` via a curated manifest (`public/fixtures/collections-manifest.json`). Pick a named package, tick individual files; fetches + extracts as `FileRecord[]`. Same 5 typed output handles as LocalFolderSource. Ideal for offline demos and saved example workflows. |
| `urlFetch` | `URLFetchNode` | `#0c4a6e`. Adds `fetchedContent`, `fetchedHtml` (cleaned body), `fetchStatus`, `fetchedAt`. AbortController cancel. URL field picker scans namespace sub-objects; runner resolves dot-notation field paths (e.g. `adsLibrary.downloadUrl`). |
| `frameSenseSource` | `FrameSenseSourceNode` | Reads a folder pre-processed by the FrameSense CLI; one record per detected shot (`framesense.*` namespace + `imageDataUrl`). No runner — pick folder manually, skipped by Run All. |

### Enriching (TaDiRAH: Enrichment)
| Key | Component | Header |
|-----|-----------|--------|
| `kclNode` | `KCLNode` | `#881337`. Per-record KCL inference. Vision-capable. Model-dependent truncation (`getContentMaxChars`). |
| `kclField` | `KCLFieldNode` | `#881337`. Single-field KCL inference. Per-record (live token preview, stream:true, partial results) or aggregate (per-value truncation). Prompt recipe bar. |
| `geocoding` | `GeocodingNode` | `#065f46`. Getty TGN + Wikidata place enrichment. Scores candidates: Dice similarity × 0.5 + tier weight × 0.3 + corroboration × 0.2; auto-resolves above threshold, else inline review panel. Candidate lists cached 30 days in localStorage. Adds `decimalLatitude`/`decimalLongitude` + `geocoding.*`. |
| `smartGeocoder` | `SmartGeocoderNode` | `#1e3a5f`. LLM-assisted place extraction (KCL arc:lite) from prose fields, then resolved via the same Getty TGN → Wikidata gazetteer as Geocoding. Adds `smartGeo.*`. Requires KCL API key. |
| `reconciliation` | `ReconciliationNode` | `#7c3aed`. Uses `/reconcile-proxy/en/api`. Scores normalised 0–1. |
| `wikidataEnrich` | `WikidataEnrichNode` | `#0369a1`. Fetches Wikidata properties for QIDs (e.g. from `*_reconciled` fields). |
| `mergeByQID` | `MergeByQIDNode` | `#6b21a8`. Merges records from multiple upstream sources by shared Wikidata QID into one record per entity. Toggle "Keep unmatched" to pass through unreconciled records unchanged. Extracts the QID from the first `*_reconciled` field found; unwraps **array-valued** `_reconciled` fields (a field can carry multiple candidate reconciliations) — see gotcha 23. |
| `ollamaNode` | `OllamaNode` | `#312e81`. `stream:true` on `/ollama/api/chat`. Vision: strip data URL prefix, use `images:[]` field, blank `{{content}}`. `tokenInput` state from `d.maxTokens` directly (TDZ gotcha). |
| `ollamaField` | `OllamaFieldNode` | `#1e1b4b`. Per-record or aggregate mode. Templates: `{{value}}`, `{{field}}`, `{{count}}`, `{{values}}`. Same TDZ gotcha as OllamaNode. |
| `htmlSection` | `HTMLSectionNode` | `#065f46`. CSS selector on `fetchedHtml` → overwrites `fetchedContent`. Adds `htmlSelector`. |
| `xmlSection` | `XMLSectionNode` | `#44403c`. XPath on `content` field (XML text) → writes `xmlContent`. Schema inspector + live preview. Strips default namespace before XPath eval. Adds `xmlXPath`. |
| `quickNote` | `QuickNoteNode` | `#0f766e`. Display-only, pass-through output handle, no runner. Three modes (selector: **Note · Structured · Score**): *Note* — free-text per-record annotation written to `_note`, field picker to read any upstream field in full while annotating. *Structured* — configure `{key,label}` fields once; per-record form assembles a clean JSON gold-standard object into a target field (default `_note`) without hand-typing JSON — flows into Evaluator's `{{__reference}}` token. A structured entry clears any prose note for that record (mutual exclusion). *Score* — constrained per-criterion human scoring; configure `{key,label,scale:number[]}` criteria + target field (default `human_score`); writes an object keyed by criterion + flat `human_c*` keys + a `labels` map for downstream display. Human counterpart to Evaluator's LLM judge. Notes shared with TableOutput via `notesStore`. |

### Analysing (TaDiRAH: Analysis)
| Key | Component | Notes |
|-----|-----------|-------|
| `filterTransform` | `FilterTransformNode` | `#4f46e5`. `TransformOp` is a discriminated union — **always replace full op on type change**. |
| `spatialFilter` | `SpatialFilterNode` | `#0891b2`. Leaflet draw → bbox filter. |
| `smartFilter` | `SmartFilterNode` | `#0f4c81`. Natural-language → filter records via KCL inference. Requires KCL API key. |
| `deduplicate` | `DeduplicateNode` | `#0f766e`. Removes duplicate records by a chosen field value. QuickStart auto-inserts this before a shared SourceProfile when a plan has 2–3 nodes of the same search type. |
| `sourceProfile` | `SourceProfileNode` | `#1f2937`. Schema inspection for one or more upstream sources: per-source completeness bars, field population rates, cross-source field correspondence map. Optional KCL-generated research narrative (arc:nano, 16k context). Pass-through output handle. |
| `fieldDistribution` | `FieldDistributionNode` | `#047857`. Faceted bar chart over a chosen field; click bars to filter records. |

### Visualising (TaDiRAH: Analysis > Visual Analysis)
| Key | Component | Notes |
|-----|-----------|-------|
| `tableOutput` | `TableOutputNode` | `#0d9488`. Pass-through output handle `id="results"` at `top:13`. Loop prevention via `useRef` fingerprint. Double-click expands. Toolbar: **show all columns** (default **on**) + **expand namespaces** (flattens one level of namespace objects into dot-notation cols). Page size selector, column sort, live text filter. `NodeResizer` (`selected` prop now destructured — see gotcha 24). |
| `mapOutput` | `MapOutputNode` | Uses `decimalLatitude`/`decimalLongitude`. |
| `timelineOutput` | `TimelineOutputNode` | ISO dates, bare years, BCE (`-1199`). |
| `timelineView` | `TimelineViewNode` | `#1e293b`. Filter records by date range on an interactive timeline; distinct from TimelineOutput (which is display-only). |
| `htmlPreview` | `HTMLPreviewNode` | `#0c4a6e`. Sandboxed iframe rendering `fetchedHtml`; click any element to capture its CSS selector and pass it back to HTMLSection/HTMLExtract. |
| `quickView` | `QuickViewNode` | `#1e293b`. No runner. Field inspector: paginates CSV/TSV (50 rows/page), truncates plain text at 50k chars. Redirects image data URLs to ImageViewNode. |
| `imageView` | `ImageViewNode` | `#1c3144`. No runner. `NodeResizer`. Two modes: **Images** (field picker for upstream records OR `imageDirectUrl` for a public URL — direct URL overrides field, suppresses record nav) and **IIIF** (v2/v3 manifest, zoom-tiered IIIF Image API requests, info.json for dimensions). Info panel: IIIF manifest metadata + image info; Images: EXIF parsed inline from first 64 KB of JPEG data URLs. |

### Disseminating (TaDiRAH: Dissemination)
| Key | Component | Notes |
|-----|-----------|-------|
| `comparisonReport` | `ComparisonReportNode` | `#3730a3`. Read-only evaluation surface; no runner, skipped by Run All. Map five report roles to upstream fields via dropdowns: *original*, *note/reference*, *response/candidate*, *judge score*, *human score*. Renders per-record cards + an aggregate agreement summary matrix. Human criterion labels (from QuickNote Score mode's `labels` map) appear in the summary. Double-click for a projector-legible full-screen view. Terminal node of the evaluation pipeline — see below. |
| `citation` | `CitationNode` | `#78350f`. Paginated bibliography from `_citation` metadata stamped by source runners. Copy all / download `.txt`. |
| `export` | `ExportNode` | `#b45309`. CSV/JSON/GeoJSON. `flattenRecord` expands `*_reconciled` to `_qid/_label/_confidence/_status` cols. |
| `jsonOutput` | `JSONOutputNode` | Double-click expands. |
| `kclOutput` | `KCLOutputNode` | `#3b0764`. Card display of `kclResponse` values with per-card copy buttons. |
| `ollamaOutput` | `OllamaOutputNode` | `#0f172a`. Reads `ollamaResponse`. No pass-through. |
| `saveSearch` | `SaveSearchNode` | Save records + metadata to `.nfcs.json`. |
| `loadSavedSearch` | `LoadSavedSearchNode` | Replay a `.nfcs.json` saved search; shows provenance metadata and per-source record counts. |

### Experimental (alpha — hidden in Simple mode, collapsed by default)
| Key | Component | Notes |
|-----|-----------|-------|
| `sparqlSearch` | `SparqlSearchNode` | `#4c1d95`. Wikidata SPARQL search via `/wdqs-proxy`. Two modes: **Builder** (instance-of picker with subclasses toggle, property-filter rows over `PROPERTY_GROUPS` — Q-id value → exact triple, text → CONTAINS filter — output-column checkboxes, live read-only query preview; `buildSparqlQuery` in `sparqlQueryBuilder.ts` is the ONLY generator) and **Raw SPARQL** (escape hatch; hand edits set `builderCustom`, any builder change regenerates over them). Keyword row seeds a `wikibase:mwapi` EntitySearch in builder mode AND names fixtures; ✨ NL assist (KCL arc:lite, SmartFilter call pattern, KCL_API_KEY_NODES member) translates plain English → SPARQL, landing in Raw mode with an explanation for review before running; wirable `query`/`limit` handles at the shell contract offsets (51/78); a query without LIMIT gets the limit row appended. Bindings → `sparql.*` namespace; `?item`/`?itemLabel`/`?itemDescription` → id/title/description; `_qid` written for WikidataEnrich/MergeByQID; WKT `Point(lon lat)` → map coordinates. Fixture: `sparqlSearch-default.json` (Turner paintings). |
| `evaluatorNode` | `EvaluatorNode` | `#3f3f46`. LLM-as-judge, runnable. Scores a `candidateField` against a `referenceField` on the **same record** using an ARC model at **temperature 0** for repeatability. Per-criterion scoring only (never one aggregate score) — built-in rubric presets (Extraction agreement, Interpretive agreement, Rubric-from-note). Template tokens: `{{__reference}}`, `{{__candidate}}`. Writes `record.eval = {scores, reasons, raw, status}` + flat `eval_c*` columns. Shows judge-vs-human agreement readout when a human score field is present. Tolerant JSON parsing — never throws; sets `status: 'parse_error'` on bad output. Requires KCL API key. |

Experimental nodes carry `alpha: true` in `SIDEBAR_ITEMS`. The group renders with an amber left-border
and `⚗` icon in the sidebar. When `simpleMode` is active the entire group is hidden (not just its items).

### Evaluation pipeline (cross-group workflow)

`quickNote`, `evaluatorNode`, and `comparisonReport` form a judge-vs-human evaluation
pipeline spanning three TaDiRAH groups:

```
source → KingsInference (generates candidate response)
       → QuickNote (Note/Structured mode — human writes reference)
       → QuickNote (Score mode — human rates criteria)
       → Evaluator (LLM judge scores candidate vs reference)
       → ComparisonReport (side-by-side cards + agreement matrix)
```

QuickNote nodes are display-only and pass records through unchanged, so they can be
placed anywhere in the chain. `notesStore` (`src/store/notesStore.ts`) keys notes by
`${nodeId}::${recordId}` — scoped to the authoring node, not global — so parallel
branches stay isolated and downstream nodes inherit a note only via the `_note`
field the authoring node injects.

Experimental nodes carry `alpha: true` in `SIDEBAR_ITEMS`. The group renders with an amber left-border
and `⚗` icon in the sidebar. When `simpleMode` is active the entire group is hidden (not just its items).

## Registration Checklist (new runnable node)

`NodeTypeId` (exported from `src/nodes/index.ts`, derived from `nodeTypes`) links the registries: `nodeRunners`
and `NODE_DEFAULTS` carry `satisfies Partial<Record<NodeTypeId, …>>` guards and `SidebarItem.type` is `NodeTypeId`,
so a typo'd or unregistered type string in steps 2/5/6 is a compile error instead of a silently missing facet.
Register the component (step 4) FIRST — the other registries type-check against it.

1. `src/utils/run<Name>Node.ts` — implement `NodeRunner`
2. Add to `src/utils/nodeRunners.ts`
3. `src/nodes/<Name>Node.tsx`
4. Add to `src/nodes/index.ts`
5. Factory in `NODE_DEFAULTS` — **`src/config/nodeDefaults.ts`** (not App.tsx)
6. Sidebar entry in `SIDEBAR_ITEMS` — **`src/config/sidebarItems.ts`** (not App.tsx)
7. Data interface + union in `AppNode` — **`src/types/AppNode.ts`** (not App.tsx)
8. Proxy rule in `server/proxies.mjs` (`PROXY_TABLE`) if needed — applies to both dev and prod automatically

**Exceptions:** `localFolderSource` (user gesture) skips 1–2. `quickView`, `imageView`, `comment` (display-only) skip 1–2 and have no handles.

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
- **`TRANSIENT_FIELDS`** in `workflowIO.ts` strips `results`, `status`, counts, `resultsVersion`, `_capped`, `_total`, `folderName`, `pdfCount/xmlCount/textCount/imageCount` before save.
- **`makeSearchRunner(config)`** in `searchRunnerFactory.ts` — builds a NodeRunner for Elasticsearch-style services (`?q&size&page` + `{total:{value},hits}`); ARIADNE and HSDS runners are ~30-line configs over it. Shared pieces (`resolveParamEdge`, `resolveLimit`, `finishRunnerSuccess/Error`) live in `runnerHelpers.ts` and are used by ALL search runners where semantics match exactly; deliberate exceptions — Europeana's limit clamp (its `Math.max(1,…)` maps negatives → 1, not the 20 fallback), the MDS/Europeana success blocks (`⚠ capped` message + `_capped`/`_total` keys), LLDS's cached/error-fallback terminals. Europeana (cursor pagination, `_capped`), Bodleian (dual terminal paths), SMG, VA, GBIF, LLDS, MDS keep bespoke PAGINATION — do NOT force-fit non-page/size services into the factory.
- **`BackboneSearchNode` config** (`src/nodes/BackboneSearchNode.tsx`) — the shared search-node COMPONENT shell (distinct from the runner factory above; a node can use the shell with a bespoke runner). `BackboneSearchConfig` is declarative: optional `sort` (dual-select by default, `singleSelect` drops the order arrow), optional `fetchAll` (bool or `{label}`), `filters: FilterSpec[]` (`select`/`text`/`checkbox`/`range` — range writes `${key}From`/`${key}To`), `extraBodyRow`, `footer` (caption / `_capped` badge / extra toggle), `statusColours`, `queryDataKey` (default `inlineQuery`). **Handle contract is frozen**: `query` top=51, `limit` top=78, output `results` — pinned by `backboneHandles.test.ts`, which must also assert every newly migrated config's serialised filter keys. Europeana (extra apiKey handle row shifts tops to 93/120) and GBIF (five wirable rows) deliberately stay OFF the shell — their handle layouts differ and the serialised-edge contract must not move.
- **`renderTemplate` / `renderFieldTemplateAggregate` / `renderFieldTemplatePerRecord`** in `promptTemplates.ts` — the ONLY implementations of `{{token}}` prompt substitution. Do not re-inline them in runners or components. The `{{_lineage}}` token is live in KCLNode/OllamaNode/Evaluator (runner AND component paths — six sites): when the user template contains it, the caller derives `lineageToNarrative(collectLineage(…))` ONCE before the record loop and spreads `_lineage` into the substitution record; templates without the token are byte-identical to before. KCLFieldNode/OllamaFieldNode are not wired (their field-mode token sets are separate — follow-up).
- **`fetchWithTimeout(url, init?, timeoutMs?)`** in `fetchWithTimeout.ts` — AbortController + 30s default. Use for any new network call in runners/clients; a fetch without a timeout can hang a Run All wave indefinitely.
- **`normaliseRecord`/`normaliseRecords`** in `recordNormalise.ts` — applied at the two legacy-record entry points (`fixtureUtils` fixture loads, `LoadSavedSearchNode`). Moves stale flat GBIF fields into `gbif.*` and drops Bodleian's old `_service`/`thumbnail` strays. Idempotent. Old fixtures and saved `.nfcs.json` files keep working without rewriting.
- **`collectUpstreamRecords(nodeId, edges)`** in `upstreamRecords.ts` — shared utility used by all process runners. TYPED_HANDLES (`pdf`, `xml`, `text`, `image`) use partitioned store keys `${sourceId}:${handle}`; all others use plain `sourceId`.
- **`useUpstreamRecords(nodeId)`** hook — same TYPED_HANDLES logic for reactivity; uses `${type}Count` key from node data.
- **`collectLineage(nodeId, nodes, edges)`** in `lineage.ts` — derive-on-demand pipeline history (docs/context-accrual.md). Walks the upstream subgraph over `data`/`results` target-handle edges (param handles are config, not data flow), applies `resolveProxyEdges` for collapsed groups, returns a topologically ordered `LineageGraph` with `stripTransient`'d params + counts read from raw data. Pure read — call from runners with `getNodes()`/`edges`, from components with `useNodes()`/`useEdges()` values. The `stale` flag is heuristic: an upstream node that never ran this session, or claims a `resultsVersion` its store no longer holds. **`lineageToNarrative(graph, {maxChars})`** (same file, default 2000 chars) renders it LLM-ready: linear chains as numbered lists, parallel branches as lettered sections with shared ancestors described once, joins under "Then:"; the budget drops earliest steps whole (never mid-sentence) and a stale graph gets an explicit warning prefix.
- **`describeNode(node)` / `lineageDescribers`** in `lineageDescribers.ts` — per-node-type one-sentence operation summaries for the lineage narrative; `satisfies Partial<Record<NodeTypeId, …>>` guard, generic label+counts fallback. Count keys are deliberately NOT uniform across runners (reconciliation `resolvedCount`/`reviewCount`, geocoding bare `resolved`/`pending`/`failed`, merge `mergedCount`/`unmatchedCount`, search `count`) — the describers pin the real names and `lineageDescribers.test.ts` fails if a runner renames one.

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
15. `XMLSectionNode` strips default XML namespace (`xmlns="..."`) before `DOMParser`/`document.evaluate` — required for XPath to work on namespaced documents.
16. `LocalFolderSourceNode` handle positions (top: 70/94/118/142/166) are fixed — the Outputs section must remain FIRST in the body with consistent heights, or handles misalign.
17. `LocalFolderSourceNode` typed store partitions: clear all 5 keys (`id`, `id:pdf`, `id:xml`, `id:text`, `id:image`) on re-scan.
18. `upstreamRecords.ts` `TYPED_HANDLES = Set(['pdf','xml','text','image'])` — `results` and `data` are NOT in this set, so they fall through to plain `sourceId` lookup.
19. KCL node truncation via `getContentMaxChars(model)` from `kclConfig.ts` — not a hard-coded constant. Per-value truncation in aggregate mode happens BEFORE joining values.
20. KCLFieldNode streaming returns accumulated full text (not empty string) from `kclChat`. In component `handleRun`, `liveTokens` state must NOT be in the `useCallback` deps array for non-streaming to work (stale closure is expected in that narrow context). Runner path stays non-streaming; partial results via per-record `setNodeResults`.
21. KCLFieldNode per-record mode: do NOT set `resultsVersion: 0` in the final `updateNodeData` after the loop — partial updates already track version correctly. Setting it to 0 resets reactivity and invisible results to downstream nodes.
22. CommentNode easter egg: click title 5 times within 1.5 seconds to unlock input/output handles for illustrating data-flow gaps.
23. `runMergeByQIDNode.ts` `extractQIDInfo` must handle **array-valued** `*_reconciled` fields, not just a single `ReconciliationResult | null` — a field can carry multiple candidate reconciliations. Always normalise with `Array.isArray(raw) ? raw : [raw]` before scanning for a resolved/review QID.
24. `TableOutputNode` column-resize drag handler: never re-read `resizingRef.current` more than once per `mousemove` after the initial null-check — cache it to a local (`const r = resizingRef.current; if (!r) return`) before use. Re-reading it later in the same handler risks a null dereference if the ref is cleared mid-drag (e.g. `mouseup` racing `mousemove`).
25. GBIF domain fields (`scientificName`, `kingdom`, …, `datasetName`, `eventDate`, `basisOfRecord`, `institutionCode`) exist ONLY under `record.gbif.*` — the adapter stores the raw occurrence wholesale and writes no flat copies. Readers use dot-notation (`gbif.scientificName`); `authoritiesForField` matches namespaced fields by last segment so typed authorities still apply. `periodStart/End/Name` are intentionally top-level — they are cross-service temporal fields written by three adapters, NOT domain-specific.
