# iDAH Federation Workflow PoC

Node-based visual workflow editor for federating UK Arts & Humanities research data services (UKRI/AHRC).

## Tech Stack

- **React SPA + thin proxy layer**: React 19 + TypeScript + Vite (port **5174**) in front of
  `server/` — plain-ESM Node (`proxies.mjs`, shared by Vite dev and the Express prod server).
- **Node editor**: `@xyflow/react` (v12+) — import ONLY from `@xyflow/react`
- **No Service Worker / PWA / workbox**
- API calls client-side via `fetch()` through same-origin proxies (`/gbif-proxy`, `/kcl-proxy`, …).
- **Engineering hand-over**: `docs/engineer-quickstart.md` (one page), `docs/architecture.md` (system briefing with diagrams), `docs/engineering-review.md` (findings + backlog), `CONTRIBUTING.md` (gates + rules).

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

## Deployment — READ BEFORE WRITING DEPLOY STEPS

Production is a single small VM: `ubuntu@nfcs-poc`, repo at `~/repos/nfcs-poc`, **9.3 GB root disk**
(`/dev/vda1`). Only `main` is deployed; `git pull` + `docker compose build` on the host. Secrets live in the
host's `.env` (never commit; never ask the user to paste it — it holds live keys).

**Disk is the recurring failure.** The app image is ~1.7 GB on disk (Node + system Chromium for Puppeteer) and a
rebuild needs ~3–4 GB of headroom on top: the builder stage runs `npm ci` with the full dev tree, the runtime
stage apt-installs Chromium, and BuildKit caches both. With < 3 GB free the build dies mid-`apt-get`/`npm ci`
with only `failed to execute bake: exit status 1` visible, and `docker compose up -d` then silently keeps
serving the OLD container. Every deploy plan must therefore start with `df -h /` and include the prune steps.

Canonical sequence (keep the running container up — it is the rollback):

```bash
df -h /                                   # need ≥ 4 GB free before building
docker tag nfcs-poc-app:latest nfcs-poc-app:previous   # protect the fallback image
docker builder prune -af                  # build cache is usually the biggest consumer (≈1–1.5 GB)
docker container prune -f && docker image prune -f
# still short? → sudo apt-get clean && sudo apt-get autoremove -y && sudo journalctl --vacuum-size=100M
#                rm -rf ~/repos/nfcs-poc/node_modules   (host checkout never needs it; .dockerignore excludes it)
git pull --ff-only origin main
docker compose build --pull --progress=plain app 2>&1 | tee /tmp/build.log   # plain + tee: `| tail` is silent for minutes
docker compose up -d app                  # recreates the container on the new image; `--profile tunnel` if Cloudflare is used
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/              # expect 200
docker rmi nfcs-poc-app:previous && docker image prune -f && docker builder prune -af && df -h /
```

- Do NOT `docker stop`/`rm` the container or `rmi` the image before building — it is unnecessary (Compose
  recreates on image change) and removes the only rollback. Rollback = `docker tag nfcs-poc-app:previous
  nfcs-poc-app:latest && docker compose up -d --no-build app`.
- Do NOT `docker system prune --volumes` / `docker volume prune`: `workflow_saves` holds workshop saves,
  `ollama_data` holds models. Ollama is a separate Compose service; `up -d app` never starts or builds it.
- Both Dockerfile stages set `ENV PUPPETEER_SKIP_DOWNLOAD=true` (builder since Nov 2026 — it never runs Chrome,
  and the download cost a few hundred MB of peak build disk). Nov 2026 deploy data point: with 3.2 GB free the
  build completed and only Compose's metadata write to `/tmp` failed — the image was already named and usable
  (`docker compose up -d --no-build app` after `docker builder prune -af`). If the disk keeps biting, the real
  fix is growing the VM volume (`sudo growpart /dev/vda 1 && sudo resize2fs /dev/vda1`) or building on a laptop
  and pushing to a registry.
- Ollama is NOT deployed on the VM (Neil, Nov 2026): no image, no models. Its Compose service and `ollama_data`
  volume are leftovers from local dev; if either shows up on the host it may be removed by name.

## Proxy Rules (`server/proxies.mjs`)

| Prefix | Target |
|--------|--------|
| `/llds-proxy/*` | `https://llds.ling-phil.ox.ac.uk/llds/*` (in `PROXY_TABLE` but unused by `src/` — LLDS search goes through `/llds-search`) |
| `/gbif-proxy/*` | `https://api.gbif.org/*` (`gbif.ts` builds URLs + fetches; the 250 ms page throttle and 429 backoff live in `runGBIFNode.ts`) |
| `/bnb-proxy/*` | `https://bnb.data.bl.uk/*` (British National Bibliography) |
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
| `/url-proxy?url=<encoded>[&js=true][&wait=<strategy>]` | Custom middleware; simple path uses Node `fetch()`; `js=true` uses Puppeteer singleton (auto-reset on `disconnected`). Wait strategies: `networkidle2` (default), `networkidle0`, `domcontentloaded`, `load`. **Policy** (`server/urlProxyPolicy.mjs`, unit-tested): http(s) only, private/loopback/link-local/metadata addresses always denied (also after DNS resolution and on every redirect hop), host must match `URL_PROXY_ALLOWLIST` (comma-separated suffixes) — unset = any public host in dev, deny-all when `NODE_ENV=production`. 10 MB body cap. |
| `/image-proxy?url=<encoded>` | Custom middleware (`imageProxyMiddleware`) for partner images whose CDNs send no CORS header (SMG `coimages.…`) or block the generic bot UA. **Fixed allowlist in code** — `IMAGE_HOST_ALLOWLIST` in `server/urlProxyPolicy.mjs` (sciencemuseumgroup.org.uk, vam.ac.uk, europeana.eu, bodleian.ox.ac.uk, nhm.ac.uk, wellcomecollection.org, gbif.org) — it ignores `URL_PROXY_ALLOWLIST` and works unchanged in production. Same private-address/redirect guards as `/url-proxy`; **415 unless upstream `Content-Type` is `image/*`**; 5 MB cap; `Cache-Control: public, max-age=86400`. The client never calls it first: `fetchImageAsDataUrl` tries a direct fetch, then this. |
| `/llds-search?q=<query>&rpp=<n>` | Custom middleware; Puppeteer solves Anubis JS proof-of-work challenge. |

NHM (`nhmSearch`) is deliberately direct-fetch with no proxy row: the portal's `robots.txt` disallows `/api/` and it asks callers for an identifying User-Agent, which only a server could set. A one-off Node-side capture (Oct 2026) was not challenged by Cloudflare, but do not add a proxy row without clearing both points with the partner (see `docs/handoff-nhm-search-node.md`, open questions).

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

Use `getContentMaxChars(model: string): number` to get the per-model limit. Applied in both runners and components. In KCLFieldNode aggregate mode the limit is passed to `aggregateFieldValues` (`aggregateValues.ts`), which truncates each value **before** concatenation and stops adding whole items at the budget.

**Streaming in KCLFieldNode (component path only):**
- `kclChat(..., onToken?: (token: string) => void)` — if `onToken` is provided, `stream: true`; otherwise `stream: false`.
- Streaming parser accumulates tokens via SSE (`data: {...}\n\n` format), firing `onToken` callback for live UI preview.
- Returns full accumulated text (not empty string) so callers can store the response in results.
- Runner (`runKCLFieldNode.ts`) stays non-streaming; partial results achieved via per-record `setNodeResults` calls.
- Both `kclChat` copies take `userContent: string | ContentPart[]` (`kclVision.ts`). Image input (`inputKind: 'image'`) sends `[{type:'text'}, {type:'image_url'}…]`; the KCL backend accepts **multiple** `image_url` parts in one message (verified 2026-11-03 with three V&A thumbnails on arc:lite — no contact-sheet fallback needed).

**Image input constants (`kclConfig.ts`):** `MAX_IMAGES_PER_CALL = 10` (default aggregate cap, UI allows 1–50), `DEFAULT_IMAGE_SEND_DIM = 512` (long edge after `resizeDataUrl`), `DEFAULT_IMAGE_SEND_SIZE = '!512,512'` (IIIF size parameter when the field is an Image API service).

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
│   ├── sidebarItems.ts          # SIDEBAR_ITEMS (every item has a required `tier`), SIDEBAR_GROUPS,
│   │                            # DEFAULT_COLLAPSED_GROUPS, visibleSidebarItems(tier), isTypeInTier —
│   │                            # single source of truth for the palette AND for display labels
│   ├── nodeTiers.ts             # NodeTier ('basic'|'intermediate'|'full'), tierIncludes, resolveStoredTier (legacy migration)
│   ├── nodeDefaults.ts          # NODE_DEFAULTS factory record, KCL_API_KEY_NODES, findSharedApiKey
│   └── assistantPrompt.ts       # DEFAULT_SYSTEM + SYSTEM_VERSION for the Assistant (ChatSidebar) — hand-written,
│                                # NOT generated from the README; assistantPrompt.test.ts pins it (see Display names)
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
Group labels are UI-only — **node `type` strings (e.g. `'gbifSearch'`) are serialised into saved workflow
files (`workflow-YYYY-MM-DD.json`; `.nfcs.json` is the SaveSearch saved-search format) and must never be renamed.**

### Workflow Planning (Canvas primitives)
| Key | Component | Notes |
|-----|-----------|-------|
| `quickStart` | `QuickStartNode` | AI workflow planner — describe a research question in plain English, KCL (arc:nexus) proposes search nodes + comments + SourceProfile/TableOutput/MapOutput; "Instantiate workflow" places them all. Requires KCL API key. Instantiated SourceProfiles start `minimised: true`; `LAYOUT.ROW_SPACING` (700) must stay larger than an expanded profile (body `maxHeight: 600` + header) or adjacent profiles overlap after Run All. |
| `comment` | `CommentNode` | No handles. `NodeResizer`. Factory sets `style: {width:220,height:120}`. |
| `param` | `ParamNode` | Display name **Search Parameter** (palette + default header). Text or Integer value; connects to search handles. |

### Discovering (TaDiRAH: Capture > Discovering)
| Key | Component | CORS |
|-----|-----------|------|
| `gbifSearch` | `GBIFSearchNode` | `/gbif-proxy/v1/occurrence/search` (throttle + 429 backoff in `runGBIFNode.ts`). Max 300/req. |
| `nhmSearch` | `NHMSearchNode` | Direct CORS fetch (POST JSON to `https://data.nhm.ac.uk/api/3/action/datastore_search`); **no proxy — `robots.txt` disallows `/api/`**. Thin config over `BackboneSearchNode` (resource body row Specimens/Index lots, single-select sort, five single-value filters). Runner is bespoke (limit/offset + `result.total`, GBIF-shaped) over `runnerHelpers.ts`; first page doubles as the total probe; 250 ms page pacing; Fetch all capped at 2,000 (`_capped`/`_total` amber convention). `nhm.*` wholesale + derived `nhm.thumbnail`/`nhm.iiifInfo` (no Presentation manifest; `nhm.iiifInfo` is a bare Image API service — ImageView lists it as a single-image IIIF entry and the AI nodes render it via `resolveImageSrc`, gotcha 30). `_pid` = `occurrenceID`. Fixtures: `stonehenge` (142), `wordsworth`. |
| `lldsSearch` | `LLDSSearchNode` | `/llds-search?q=&rpp=` — Puppeteer middleware solves the site's Anubis proof-of-work, `llds.ts` scrapes the DSpace discover page. 15s timeout → localStorage cache fallback (`lldsCache.ts`). Thin config over `BackboneSearchNode` (useCache footer toggle). |
| `ariadneSearch` | `ARIADNESearchNode` | Direct CORS fetch. Pan-European archaeology portal (40+ institutions, 23 countries). Filters: Resource type, Getty AAT subject, Native subject, Country, Data type, Period, Contributor (set Contributor = "Archaeology Data Service" for ADS records). |
| `hsdsSearch` | `HSDSSearchNode` | Vite proxy, no Cloudflare. Heritage Science Data Service — UK heritage aggregator (Historic England, HES, Cadw). Same filter set as ARIADNESearch plus Country = England/Scotland/Wales/Northern Ireland. `hsds.*` namespace. |
| `bodleianSearch` | `BodleianSearchNode` | `/bodleian-proxy/*`. Oxford Bodleian Digital Collections. Filters: date range, language, origins, completeness, musical notation. `bodleian.manifest` → feeds ImageView (IIIF mode). Fixture mode supported. Thin config over `BackboneSearchNode` (single-select sort, fq* filters). |
| `europeanaSearch` | `EuropeanaSearchNode` | Pre-configured API key (overridable via Param → apiKey handle). Cursor pagination up to 1,000 records. Adds `europeana.thumbnail`, `europeana.shownAt`, `europeana.rights`. |
| `smgSearch` | `SMGSearchNode` | `/smg-proxy/*`. Science Museum Group collection. `smg.manifest` (IIIF) → ImageView — emitted **only when the object has digitised media** (`smg.thumbnail` present); SMG publishes an empty manifest (`canvases: []`) for the rest, and `recordNormalise` drops the manifest from old fixtures/saved searches the same way (gotcha 31). `smg.thumbnail` lives on `coimages.sciencemuseumgroup.org.uk`, which sends no CORS header → the AI nodes fetch it via `/image-proxy`. Fixture mode supported. Thin config over `BackboneSearchNode` (searchType body row switches endpoint). |
| `vaSearch` | `VASearchNode` | `/vam-proxy/*`. V&A collection (API v2). Filters: images only, object type, year made from/to. `vam.manifest`, `vam.iiifImageBase`, `vam.thumbnail`. `vam.iiifImageBase` is a bare IIIF Image API base (404s if opened as-is — gotcha 30); 273 of the 1,105 fixture records have a base but no manifest, and ImageView's IIIF picker lists them as single-image entries. Thin config over `BackboneSearchNode`. |
| *(removed)* `adsSearchAdvanced`, `adsLibrarySearch` | — | Removed Oct 2026 (Cloudflare-blocked). ADS records come via ARIADNESearch (Contributor = "Archaeology Data Service"). Old workflows containing them load with a warning; the `ads.*` record namespace is kept. |
| `mdsSearch` | `MDSSearchNode` | `/mds-proxy`. Two-step HTML scraper. Capped at 200 (amber status text). Thin config over `BackboneSearchNode`. |

### Gathering (TaDiRAH: Capture > Gathering)
| Key | Component | Notes |
|-----|-----------|-------|
| `localFolderSource` | `LocalFolderSourceNode` | File System Access API — no runner (user gesture required). `dirHandle` in `useRef`, lost on refresh. 5 typed output handles: `results` (all), `pdf`, `xml`, `text`, `image`; partitioned store keys `${id}:pdf` etc. |
| `localFileSource` | `LocalFileSourceNode` | No runner. `fileMode: 'csv' \| 'xml' \| 'image'`. CSV → column-keyed rows; xml/image → single `FileRecord` via `extractFileContent`. |
| `sampleDataSource` | `SampleDataSourceNode` | **Has a runner — participates in Run All** (unlike LocalFolderSource/LocalFileSource). Loads pre-packaged collection files from `public/fixtures/` via a curated manifest (`public/fixtures/collections-manifest.json`). Pick a named package, tick individual files; fetches + extracts as `FileRecord[]`. Same 5 typed output handles as LocalFolderSource. Ideal for offline demos and saved example workflows. |
| `urlFetch` | `URLFetchNode` | `#0c4a6e`. Adds `fetchedContent`, `fetchedHtml` (cleaned body), `fetchStatus`, `fetchedAt`. AbortController cancel. URL field picker scans namespace sub-objects; runner resolves dot-notation field paths (e.g. `europeana.shownAt`). |
| `frameSenseSource` | `FrameSenseSourceNode` | Reads a folder pre-processed by the FrameSense CLI; one record per detected shot (`framesense.*` namespace + `imageDataUrl`). No runner — pick folder manually, skipped by Run All. |

### Enriching (TaDiRAH: Enrichment)
| Key | Component | Header |
|-----|-----------|--------|
| `kclNode` | `KCLNode` | `#881337`. Display name **AI Inference**. Per-record KCL inference. Vision-capable (one image per record: `imageField` dot-path or auto-detect; data URLs, http(s) image URLs and IIIF Image API services all go through `buildUserContent` in `kclVision.ts`). The Vision row is ALWAYS rendered (caption says what to connect when no image field is upstream) and `visionMode = defaultVisionMode(upstreamRecords, d.visionMode)` in both component and runner — an explicit tick wins, else on when every upstream record is an image (an Image View capture collection). The Image picker lists `content (captured image)` first. `buildUserContent` is awaited inside the per-record try in both paths: one unloadable image yields `[error: image: …]` for that record and the run continues. No separate "captures" handle: a capture collection is a record set, so the per-record path sends one crop per call and AI Inference (by field) image-aggregate over `content` sends the whole collection in one call. Prompt chips and `{{token}}`s accept dot-paths (`{{vam.objectType}}`) via `collectFieldPaths`. Model-dependent truncation (`getContentMaxChars`). |
| `kclField` | `KCLFieldNode` | `#881337`. Display name **AI Inference (by field)**. Single-field KCL inference; the Field picker is `collectFieldPaths` grouped by namespace (`path (n of N)`, 🖼 for image-kind), values read with `getFieldByPath`. Per-record (live token preview, stream:true, partial results) or aggregate — text aggregate goes through `aggregateFieldValues`: every value headed `id: <id> · title (Source)` (`labelValues`, default true, checkbox under Mode), empty values skipped, `{{count}}`/`kclAggregatedFrom` = values sent, status `n of N records` when they differ; only `{{values}}`/`{{field}}`/`{{count}}` substitute in aggregate mode and the node shows an amber warning naming any other token (it would go as literal text). **Input `Text ◦ Image`** (`inputKind`, defaults to image when the selected path is image-kind): per-record sends `[text, image]` with `{{value}}` = record `title || id`, a record whose image cannot be fetched gets `[image unavailable: …]` and the run continues; aggregate sends ONE call with up to `maxImages` image parts, each introduced by a numbered `title (Source)` line, `{{count}}` = images sent, status `N of M images sent`. Writes `kclInputKind`. Prompt recipe bar. |
| `geocoding` | `GeocodingNode` | `#065f46`. Getty TGN + Wikidata place enrichment. Scores candidates: Dice similarity × 0.5 + tier weight × 0.3 + corroboration × 0.2; auto-resolves above threshold, else inline review panel. Candidate lists cached 30 days in localStorage. Adds `decimalLatitude`/`decimalLongitude` + `geocoding.*`. |
| `smartGeocoder` | `SmartGeocoderNode` | `#1e3a5f`. LLM-assisted place extraction (KCL arc:lite) from prose fields, then resolved via the same Getty TGN → Wikidata gazetteer as Geocoding. Adds `smartGeo.*`. Requires KCL API key. |
| `reconciliation` | `ReconciliationNode` | `#7c3aed`. Uses `/reconcile-proxy/en/api`. Scores normalised 0–1. |
| `wikidataEnrich` | `WikidataEnrichNode` | `#0369a1`. Fetches Wikidata properties for QIDs (e.g. from `*_reconciled` fields). |
| `mergeByQID` | `MergeByQIDNode` | `#6b21a8`. Merges records from multiple upstream sources by shared Wikidata QID into one record per entity. Toggle "Keep unmatched" to pass through unreconciled records unchanged. Extracts the QID from the first `*_reconciled` field found; unwraps **array-valued** `_reconciled` fields (a field can carry multiple candidate reconciliations) — see gotcha 23. |
| `ollamaNode` | `OllamaNode` | `#312e81`. `stream:true` on `/ollama/api/chat`. Vision: strip data URL prefix, use `images:[]` field, blank `{{content}}`. `tokenInput` state from `d.maxTokens` directly (TDZ gotcha). |
| `ollamaField` | `OllamaFieldNode` | `#1e1b4b`. Per-record or aggregate mode. Templates: `{{value}}`, `{{field}}`, `{{count}}`, `{{values}}`. Aggregate shares `aggregateFieldValues` with `kclField` (id headings, `labelValues` checkbox, stray-token warning; uncapped — no model char limits for Ollama). Same TDZ gotcha as OllamaNode. |
| `htmlSection` | `HTMLSectionNode` | `#065f46`. CSS selector on `fetchedHtml` → overwrites `fetchedContent`. Adds `htmlSelector`. |
| `xmlSection` | `XMLSectionNode` | `#44403c`. XPath on `content` field (XML text) → writes `xmlContent`. Schema inspector + live preview. Strips default namespace before XPath eval. Adds `xmlXPath`. |
| `quickNote` | `QuickNoteNode` | `#0f766e`. Display-only, pass-through output handle, no runner. Three modes (selector: **Note · Structured · Score**): *Note* — free-text per-record annotation written to `_note`, field picker to read any upstream field in full while annotating. *Structured* — configure `{key,label}` fields once; per-record form assembles a clean JSON gold-standard object into a target field (default `_note`) without hand-typing JSON — flows into Evaluator's `{{__reference}}` token. A structured entry clears any prose note for that record (mutual exclusion). *Score* — constrained per-criterion human scoring; configure `{key,label,scale:number[]}` criteria + target field (default `human_score`); writes an object keyed by criterion + flat `human_c*` keys + a `labels` map for downstream display. Human counterpart to Evaluator's LLM judge. Notes shared with TableOutput via `notesStore`. |

### Analysing (TaDiRAH: Analysis)
| Key | Component | Notes |
|-----|-----------|-------|
| `filterTransform` | `FilterTransformNode` | `#4f46e5`. Display name **Filter and Transform**. `TransformOp` is a discriminated union — **always replace full op on type change**. |
| `spatialFilter` | `SpatialFilterNode` | `#0891b2`. Leaflet draw → bbox filter. |
| `smartFilter` | `SmartFilterNode` | `#0f4c81`. Natural-language → filter records via KCL inference. Requires KCL API key. |
| `deduplicate` | `DeduplicateNode` | `#0f766e`. Removes duplicate records by a chosen field value. QuickStart auto-inserts this before a shared SourceProfile when a plan has 2–3 nodes of the same search type. |
| `sourceProfile` | `SourceProfileNode` | `#1f2937`. Schema inspection for one or more upstream sources: per-source completeness bars, field population rates, cross-source field correspondence map. Optional KCL-generated research narrative (arc:nano, 16k context). Pass-through output handle. Banner colour is `sourceIdentity(source).banner` (the dark variant of the shared table — gotcha 32). Persisted `minimised?: boolean` (header ▸/▾ button) collapses the body to a one-line summary — see gotcha 28. |
| `fieldDistribution` | `FieldDistributionNode` | `#047857`. Faceted bar chart over a chosen field; click bars to filter records. |

### Visualising (TaDiRAH: Analysis > Visual Analysis)
| Key | Component | Notes |
|-----|-----------|-------|
| `tableOutput` | `TableOutputNode` | `#0d9488`. Pass-through output handle `id="results"` at `top:13`. Loop prevention via `useRef` fingerprint. Double-click expands. Toolbar: **show all columns** (default **on**) + **expand namespaces** (flattens one level of namespace objects into dot-notation cols). Page size selector, column sort, live text filter. `NodeResizer` (`selected` prop now destructured — see gotcha 24). Header badges `📍 n/N`, `📅 n/N` and `🖼 n/N` from `countFacets` (`recordFacets.ts`: MapOutput's exact coordinate predicate, the Timeline's `resolveRecordYear`, and the AI pickers' image-kind paths via `collectFieldPaths` — thumbnails, data URLs, IIIF manifests and Image API services) — greyed, never hidden, at 0; tooltips say which node to connect. |
| `mapOutput` | `MapOutputNode` | Uses `decimalLatitude`/`decimalLongitude` (`hasCoordinates` in `recordFacets.ts`). Marker colour, popup and legend names come from `sourceIdentity` (gotcha 32); Leaflet `circleMarker`s carry colour only — the per-institution SHAPE the Timeline adds is not available on the map. Clustering (`leaflet.markercluster`) is on by default. |
| `timelineView` | `TimelineViewNode` (in `TimelineOutputNode.tsx`) | `#1e293b`. Display name **Timeline** — the only timeline entry in the palette. Interactive year-resolution timeline; drag range handles to filter, pass-through output. ISO dates, bare years, BCE (`-1199`). Automatic field priority is `periodStart → date → gbif.eventDate` (`AUTO_DATE_FIELDS` in `dateUtils.ts`, shared with the runner — gotcha 29); the legend's "year from:" key and the tooltip name the field each year came from; the `dateField` select overrides. Markers take colour AND shape (●■▲◆) from `sourceIdentity` so institutions stay distinguishable (gotcha 32); `Marker` applies per-shape radius factors (square ×0.9, triangle ×1.2, diamond ×1.15) to equalise visual weight; within a year's stack items are sorted by `compareBySourceShape` so same-shape sources cluster; legend (sorted by count) and tooltip show display names, raw `_source` as the legend tooltip. |
| `timelineOutput` | alias → same component + runner | Legacy type kept registered (and `hidden: true` in `SIDEBAR_ITEMS`) so old workflows load and minimap/lineage lookups resolve; not offered in the palette. It was never display-only despite older notes. |
| `htmlPreview` | `HTMLPreviewNode` | `#0c4a6e`. Sandboxed iframe rendering `fetchedHtml`; click any element to capture its CSS selector and pass it back to HTMLSection/HTMLExtract. |
| `quickView` | `QuickViewNode` | `#1e293b`. No runner. Field inspector: paginates CSV/TSV (50 rows/page), truncates plain text at 50k chars. Redirects image data URLs to ImageViewNode. |
| `imageView` | `ImageViewNode` | `#1c3144`. No runner. `NodeResizer`. Two modes: **Images** (grouped field `<select>` — "Image fields" first as `path (n of N)` via `collectImageFieldCandidates`, then "Other fields", then Custom… free text; auto-selects the only/clearly dominant image field; navigation runs over `recordsWithField` only, nav reads `n/k (N upstream)` and an empty subset shows a hint instead of a blank canvas — OR `imageDirectUrl` for a public URL — direct URL overrides field, suppresses record nav and the subset) and **IIIF** (records primary, canvases secondary). IIIF entries come from `collectIiifEntries` — one per record: any namespace `manifest` (Bodleian/SMG/V&A/…) else an Image API service (`vam.iiifImageBase`, `nhm.iiifInfo`) as a single-image entry; no cap; options read `Source · title` (+ accession number when titles repeat). The bottom ‹ n/N › steps **records** (auto-loading each entry); a `‹ canvas n/k ›` stepper appears in the region bar only for multi-canvas manifests; the header line reads `Source · title` with `_sourceUrl` as tooltip. Manifests are fetched direct → partner proxy (`partnerProxyUrl`) → `/url-proxy`. **Capture ACCUMULATES**: each Capture appends the current regions (or the whole canvas) to the node's collection (`appendCaptures(getNodeResults(id), recs)` → `setNodeResults` → `imageCount: all.length`), so draw → capture → next canvas/record → draw → capture builds a curated set of crops; the regions are consumed on success and only *uncaptured* regions are dropped on real canvas navigation (ref-guarded, so saved regions survive first load). A **capture gallery** sits between the image and the zoom bar whenever the collection is non-empty: `captures = getNodeResults(id).filter(isCaptureRecord)` memoised on `d.resultsVersion` (the store is the truth — after a reload the gallery is simply empty); 64 px tiles of `_captureThumb` (160 px, made with `resizeDataUrl` at capture time; a thumb failure never fails the capture) with `#n` badges, hover = the capture `description`, a per-tile × (`removeCapture` → `setNodeResults`; last one → `clearCaptures`) and the clear-all `✕ captures` in the gallery header (no longer in the region bar). **Click a tile** = `resolveCaptureTarget(rec, iiifEntries)`: same entry → `setCanvasIndex`; another upstream entry → `loadEntry(entry, {canvasIndex})`; record gone upstream → `loadManifest(url, {canvasIndex})` or `showImageService` rebuilt from the capture's own keys (`_captureEntryUrl/Kind`, `_captureCanvasKey`). The clicked capture becomes `highlight` state (fractions + two strings, never node data) and is drawn as an amber dashed outline + label only while `currentCanvasKey === highlight.canvasKey`; cleared by a second click, entering draw mode, capturing, clearing, removing it, or a mode switch. `loadManifest` returns early when `loadedUrlRef` moved on during its fetch (two fast loads no longer race). Legacy captures without `_captureEntryUrl` render but are not clickable. A status line under the region bar reads `✓ n captured (m in collection)` or lists the regions that failed with both attempted sizes (per-region try/catch — no more silent `imageCount: 0`). Records come from `buildCaptureRecord` (`captureRecords.ts`): `pickProvenance(record)` (id, title, `_sourceUrl`, `_citation`, `_pid`, namespace object, `_origin`, parent `description` → `sourceDescription`) + `content`/`contentType:'image'`, `title` = region label, `description` = capture label `Source · title · canvas n/k · Region i` (what AI Inference's vision-mode `{{content}}` renders), `captureSource`, `captureRecordTitle`, `regionBounds`, `canvasIndex`, `capturedAt`, `_id` = `${nodeId}_cap_${seq}_${i}`. Regions are fetched by `fetchIiifRegion` (sized `!1024,1024`, then `max` + client resize — gotcha 33). The viewer keeps a `sizedRefused` Set: an IIIF `<img onError>` on a sized tier re-renders at `/full/max/` and the Info panel's Requesting row says the server refused the constrained size. `setMode('iiif')` clears a non-capture Images-mode record so the counter is honest; switching back to Images replaces the collection with its single record. `loadedUrlRef` guards the saved-URL effect — the entries memo is rebuilt whenever `records` changes identity, so an effect keyed on it ping-ponged between entries. Info panel: IIIF manifest metadata + image info; Images: EXIF parsed inline from first 64 KB of JPEG data URLs. Images mode resolves the `<img>` src with `resolveImageSrc` so Image API bases render, and its nav label also reads `Source · title` (`sourceName(_source)`, tooltip `_sourceUrl`) with Source / Title / ID / Record / Field rows at the top of the ℹ Info panel; `recordTitle` (bare) is what the captured record and `<img alt>` carry — never the prefixed label. |

### Disseminating (TaDiRAH: Dissemination)
| Key | Component | Notes |
|-----|-----------|-------|
| `comparisonReport` | `ComparisonReportNode` | `#3730a3`. Read-only evaluation surface; no runner, skipped by Run All. Map five report roles to upstream fields via dropdowns: *original*, *note/reference*, *response/candidate*, *judge score*, *human score*. Renders per-record cards + an aggregate agreement summary matrix. Human criterion labels (from QuickNote Score mode's `labels` map) appear in the summary. Double-click for a projector-legible full-screen view. Terminal node of the evaluation pipeline — see below. |
| `citation` | `CitationNode` | `#78350f`. Paginated bibliography from `_citation` metadata stamped by source runners. Copy all / download `.txt`. |
| `export` | `ExportNode` | `#b45309`. CSV/JSON/GeoJSON. `flattenRecord` expands `*_reconciled` to `_qid/_label/_confidence/_status` cols. |
| `jsonOutput` | `JSONOutputNode` | Double-click expands. |
| `kclOutput` | `KCLOutputNode` | `#3b0764`. Display name **AI Inference Output**. Card display of `kclResponse` values with per-card copy buttons. Cards are keyed by `cardKey` = `_id ?? id` — Image View captures inherit the parent record's `id`, so keying by `id` made sibling crops share expand/copy state and React keys. A capture card (`captureSource` present) shows its `_captureThumb` (44 px) left of the title and is titled by its `description` (`Source · title · canvas n/k · Region i`), not the bare region label. |
| `ollamaOutput` | `OllamaOutputNode` | `#0f172a`. Reads `ollamaResponse`. No pass-through. |
| `saveSearch` | `SaveSearchNode` | Save records + metadata to `.nfcs.json`. |
| `loadSavedSearch` | `LoadSavedSearchNode` | Replay a `.nfcs.json` saved search; shows provenance metadata and per-source record counts. |

### Experimental (alpha — collapsed by default; `sparqlSearch` from Intermediate tier, `frameSenseSource` Full only)
| Key | Component | Notes |
|-----|-----------|-------|
| `sparqlSearch` | `SparqlSearchNode` | `#4c1d95`. Wikidata SPARQL search via `/wdqs-proxy`. Two modes: **Builder** (instance-of picker with subclasses toggle, property-filter rows over `PROPERTY_GROUPS` — Q-id value → exact triple, text → CONTAINS filter — output-column checkboxes, live read-only query preview; `buildSparqlQuery` in `sparqlQueryBuilder.ts` is the ONLY generator) and **Raw SPARQL** (escape hatch; hand edits set `builderCustom`, any builder change regenerates over them). Keyword row seeds a `wikibase:mwapi` EntitySearch in builder mode AND names fixtures; ✨ NL assist (KCL arc:lite, SmartFilter call pattern, KCL_API_KEY_NODES member) translates plain English → SPARQL, landing in Raw mode with an explanation for review before running; wirable `query`/`limit` handles at the shell contract offsets (51/78); a query without LIMIT gets the limit row appended. Bindings → `sparql.*` namespace; `?item`/`?itemLabel`/`?itemDescription` → id/title/description; `_qid` written for WikidataEnrich/MergeByQID; WKT `Point(lon lat)` → map coordinates. Fixture: `sparqlSearch-default.json` (Turner paintings). |
| `evaluatorNode` | `EvaluatorNode` | `#3f3f46`. LLM-as-judge, runnable. Scores a `candidateField` against a `referenceField` on the **same record** using an ARC model at **temperature 0** for repeatability. Per-criterion scoring only (never one aggregate score) — built-in rubric presets (Extraction agreement, Interpretive agreement, Rubric-from-note). Template tokens: `{{__reference}}`, `{{__candidate}}`. Writes `record.eval = {scores, reasons, raw, status}` + flat `eval_c*` columns. Shows judge-vs-human agreement readout when a human score field is present. Tolerant JSON parsing — never throws; sets `status: 'parse_error'` on bad output. Requires KCL API key. |

Experimental nodes carry `alpha: true` in `SIDEBAR_ITEMS`. The group renders with an amber left-border
and `⚗` icon in the sidebar. Like every group, it disappears entirely when none of its items are in the
current visibility tier (so Basic never shows an Experimental heading).

### Node visibility tiers (Basic / Intermediate / Full)

Replaced the two-state Simple/Advanced toggle in Nov 2026. `src/config/nodeTiers.ts` is pure and unit-tested;
every `SidebarItem` declares a **required** `tier` (the minimum tier at which it appears — `tsc` fails without it).
The top-bar segmented control sets `nodeTier` (App state, persisted under `STORAGE_KEYS.NODE_TIER`; the legacy
`nfcs_simple_mode` boolean is read once by `resolveStoredTier` — Simple → basic, Advanced → full — default basic).
`visibleSidebarItems(tier)` drives the Sidebar and `isTypeInTier` filters `ConnectionSuggestions`, so a user is
never offered a node they cannot find in the palette. **`src/__tests__/nodeTiers.test.ts` pins the EXACT type set
per tier** — when you move or add a node, change the test list and this table together.

| Tier | Contains |
|---|---|
| Basic | `param`, `comment`, all ten Discovering sources, `localFileSource`, `sampleDataSource`, `kclNode`, `kclField`, `kclOutput`, `fieldDistribution`, `sourceProfile`, `tableOutput`, `mapOutput`, `timelineView`, `citation`, `export`, `saveSearch`, `loadSavedSearch` |
| Intermediate | Basic + `quickStart`, `localFolderSource`, `urlFetch`, `htmlSection`, `xmlSection`, `reconciliation`, `wikidataEnrich`, `filterTransform`, `deduplicate`, `quickView`, `imageView`, `htmlPreview`, `jsonOutput`, `sparqlSearch` |
| Full | everything: + `geocoding`, `smartGeocoder`, `mergeByQID`, `quickNote`, `ollamaNode`, `ollamaField`, `ollamaOutput`, `smartFilter`, `spatialFilter`, `evaluatorNode`, `comparisonReport`, `frameSenseSource` |

**Display names vs type keys.** A few nodes have plain-English labels that differ from their type key:
`param` → **Search Parameter**, `kclNode` → **AI Inference**, `kclField` → **AI Inference (by field)**,
`kclOutput` → **AI Inference Output**, `filterTransform` → **Filter and Transform**, `timelineView` → **Timeline**.
The palette, canvas header titles, `ConnectionSuggestions` (labels looked up from `SIDEBAR_ITEMS`, never
hardcoded), `TADIRAHMapping`, `SourceProfile` suggestion chips and the Assistant system prompt all use the display
names. Type keys are serialised and never change. The Assistant prompt lives in `src/config/assistantPrompt.ts`
(hand-written — not built from the README); bump `SYSTEM_VERSION` there whenever the prompt text changes, or users
keep the localStorage-cached copy. `assistantPrompt.test.ts` fails when a non-hidden `SIDEBAR_ITEMS` label is
missing from the prompt (as `**label**`), the tiers are not explained, the version has not moved past the previous
release, or the prompt exceeds 30 k chars — so adding a node means adding its bullet there too.

### Evaluation pipeline (cross-group workflow)

`quickNote`, `evaluatorNode`, and `comparisonReport` form a judge-vs-human evaluation
pipeline spanning three TaDiRAH groups:

```
source → AI Inference (generates candidate response)
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

## Guardrails (added Oct 2026 — see docs/engineering-review.md)

- **Four gates, all in CI** (`.github/workflows/ci.yml`): `npm run lint` (0 errors; warnings are the backlog),
  `npm run typecheck`, `npx vitest run`, `npx vite build`. Plus a gitleaks scan (soft-fail) and hard-failing greps for
  `sk-…` key patterns in `public/` and `src/`, `utm_campaign=` under `public/`, and any non-empty `"apiKey"` in `public/examples/`.
- **`apiKey` is in `TRANSIENT_FIELDS`** — never serialised, and a Param node wired into an `apiKey` handle has
  its `value` blanked on save (`CREDENTIAL_HANDLES` in `workflowIO.ts`). `hydrateNodes` re-injects the build-time
  default for `KCL_API_KEY_NODES` and `europeanaSearch`. `examplesNoSecrets.test.ts` fails on ANY `apiKey` value in
  an example, on Europeana's `utm_campaign=<wskey>` tracking parameter anywhere under `public/` (the adapter strips
  it from item URLs — `cleanItemUrl` in `europeanaAdapter.ts`), and on any locally configured `VITE_*_API_KEY`
  value appearing in shipped data; CI greps `public/` and `src/` the same way.
- **Unknown node types** in a loaded workflow file are dropped with their edges (`partitionUnknownNodes`) and
  reported through the top-bar `loadError` banner. Retire a node by removing it; never rename a type string.
- **Runner contract is tested** (`runnerContract.test.ts`): never throw, terminal status, `clearNodeResults`
  before any validation early-return. Wrap new runners the way `runDeduplicateNode` does.
- **Results store eviction**: `clearNodeResultsDeep(id)` on node delete (App `onNodesDelete`),
  `clearAllResults()` when a workflow replaces the canvas.
- `STATUS_BORDER`/`STATUS_BADGE` treat `running` and `loading` as synonyms — use the theme map, not a private one.
- Header colours in the tables below are the ORIGINAL Tailwind hexes and are stale; the live values are
  `NODE_IDENTITY` in `src/styles/theme.ts` (and must match `sidebarItems.ts`).

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
9. Colour in `NODE_IDENTITY` (`src/styles/theme.ts`) — must match the `sidebarItems.ts` entry
10. If the node is a data source / process / inference node: add it to the suggestion sets in
    `src/components/ConnectionSuggestions.tsx` (and `NODE_PARAM_HANDLES` if it has wirable param handles)
11. A one-line describer in `src/utils/lineageDescribers.ts` (else the generic fallback is used)
12. If QuickStart should be able to plan it: the type lists in `src/nodes/QuickStartNode.tsx`

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
- **`aggregateFieldValues(records, field, {label, maxChars})` / `recordHeading` / `DEFAULT_AGGREGATE_PROMPT`** in `aggregateValues.ts` — the ONLY builder of the field nodes' aggregate `{{values}}` block (KCL + Ollama, runner + component — four hand-copied join blocks collapsed Nov 2026). Each value is headed `id: <id> · title (Source)` so the model can cite records (named, not numbered — a numbered heading made the model cite positions) (`label: false` = the legacy bare join); flat key then dot path; empties dropped; per-value truncation then whole items added while under `maxChars`; returns `{values, included, total}` — callers pass `included` as `{{count}}`.
- **`getFieldByPath(record, 'a.b.c')` / `nonEmptyString`** in `fieldPath.ts` — the shared dot-notation resolver. ImageView, Timeline, the KCL nodes (`renderTemplate`'s `{{a.b}}` tokens, KCLField value reads) use it; `SmartFilterNode` and `SourceProfileNode` still carry private `resolveField` copies (follow-up: switch them).
- **`toYear` / `resolveRecordYear(r, dateField?)` / `AUTO_DATE_FIELDS`** in `dateUtils.ts` — the ONLY year resolution; used by `TimelineViewNode`, `runTimelineViewNode` and the table's 📅 badge. Returns `{ year, field }` so callers can say where the year came from.
- **`collectImageFieldCandidates` / `recordsWithField` / `IMAGE_KEYS` / `IMAGE_VALUE`** in `imageFields.ts` — image-field discovery and the per-field population counts behind ImageView's picker. `IMAGE_KEYS` is deliberately broad (url/href/src match record-page links too) — decided Nov 2026. `IMAGE_VALUE` also matches `…/info.json`.
- **`resolveImageSrc(path, value, size?)` / `imageServiceBase` / `imageServiceUrl` / `isImageServiceRef` / `IIIF_SERVICE_KEYS`** in `iiifImage.ts` — the ONLY place that turns a IIIF Image API service (`vam.iiifImageBase`, `nhm.iiifInfo`) into a fetchable URL (`${base}/full/${size}/0/default.jpg`); data:/http(s) values pass through. Also home of `extractServiceBase`, `iiifSizeParam`, `iiifSizeLabel`. ImageView, kclVision and fieldPaths all use it.
- **`sourceIdentity(src)` / `SOURCE_IDENTITIES` / `SOURCE_NAMES` / `sourceName` / `SHAPE_GLYPHS` / `compareBySourceShape` / `FALLBACK_COLOUR`** in `sourceIdentity.ts` — the ONE table of how a `_source` is named and drawn: display name, mid-tone `colour`, dark `banner`, `MarkerShape`. Timeline, Map, Source Profile, ImageView labels and the AI image list text read it; `iiifEntries.ts` re-exports `SOURCE_NAMES`/`sourceName`. `sourceIdentity.test.ts` pins the 16 runtime `_source` keys and asserts distinct colours. Unknown keys get a neutral grey circle and a capitalised name.
- **`collectIiifEntries(records)`** in `iiifEntries.ts` — ImageView's IIIF picker list (manifest or image-service entry per record, de-duped by url, labels disambiguated with accession numbers).
- **`countFacets(records)` / `hasCoordinates` / `hasPlottableDate` / `imagePathsOf` / `hasImage`** in `recordFacets.ts` — the ONLY per-record coordinate/date/image predicates, behind the Table badges, the Map's mappable filter and GeoJSON export. Do not re-inline `decimalLatitude != null && decimalLongitude != null`.
- **`partnerProxyUrl(url)`** in `partnerProxies.ts` — maps a partner API host to its same-origin proxy prefix (`collection.sciencemuseumgroup.org.uk` → `/smg-proxy`, …) so a manifest URL from a record can be fetched with the partner's expected headers when the direct fetch fails.
- **`fetchImageAsDataUrl(url, {maxDim, timeoutMs})` / `resizeDataUrl` / `blobToDataUrl` / `IMAGE_MAX_DIM`** in `imageFetch.ts` — the ONLY image→data-URL path: data: → resize only; http(s) → direct fetch, then once via `/image-proxy`. `maxDim: 0` disables the canvas resize (needed under jsdom). KCLNode, runKCLNode, kclVision and ImageView's capture all use it.
- **`collectFieldPaths(records, {sample})`** in `fieldPaths.ts` — `{path, kind: 'scalar'|'array'|'image', count}` per top-level and one-level-nested field (one representative per `_source` + a sample for counts; skips `_`-prefixed and `*_reconciled`). Drives the KCLField picker and KCLNode's chips/image-field candidates. `IMAGE_KIND_KEYS` is narrower than `IMAGE_KEYS` on purpose (a `url` key is not an image).
- **`fetchIiifRegion(serviceUrl, {region?, size?, maxDim?})` / `iiifRegionParam` / `DEFAULT_REGION_SIZE`** in `imageFetch.ts` — the ONLY IIIF region fetch: `${service}/${pct:…|full}/${size}/0/default.jpg` via `fetchImageAsDataUrl(…, {maxDim: 0})`, and on any error the same region at `max` resized client-side to `maxDim` (SMG — gotcha 33). Throws naming both attempts (`sized !1024,1024 → HTTP 403; max → …`).
- **`buildCaptureRecord` / `appendCaptures` / `removeCapture` / `resolveCaptureTarget` / `isCaptureRecord` / `pickProvenance` / `CaptureMeta` / `CaptureEntryKind`** in `captureRecords.ts` — the shape of an Image View capture and how captures accumulate (existing capture records + new ones; an Images-mode single record is dropped). A capture carries its navigation keys (`_captureEntryUrl`, `_captureEntryKind` manifest/image/manual, `_captureCanvasKey` = serviceUrl||directUrl, `canvasIndex`) and an optional `_captureThumb` — all `_`-prefixed (gotcha 34); `resolveCaptureTarget(capture, entries)` turns them into `{entry?, url, kind, canvasIndex, canvasKey, region}` for the gallery (null for a legacy capture). Pure and unit-tested; ImageView holds no private copy.
- **`defaultVisionMode(records, stored?)`** in `kclVision.ts` — `stored ?? (records.length > 0 && every contentType === 'image')`; KCLNode and runKCLNode must agree, so neither computes it inline.
- **`buildUserContent` / `imagePartFor` / `collectImageParts` / `imageListText` / `recordLabel` / `ContentPart`** in `kclVision.ts` — the ONE builder of OpenAI-style multipart content for the KCL nodes (component and runner paths). `collectImageParts` fetches sequentially (partner CDNs rate-limit bursts) and reports failures instead of throwing.
- **`fetchWithTimeout(url, init?, timeoutMs?)`** in `fetchWithTimeout.ts` — AbortController + 30s default. Use for any new network call in runners/clients; a fetch without a timeout can hang a Run All wave indefinitely.
- **`normaliseRecord`/`normaliseRecords`** in `recordNormalise.ts` — applied at the two legacy-record entry points (`fixtureUtils` fixture loads, `LoadSavedSearchNode`). Moves stale flat GBIF fields into `gbif.*` and drops Bodleian's old `_service`/`thumbnail` strays. Idempotent. Old fixtures and saved `.nfcs.json` files keep working without rewriting.
- **`collectUpstreamRecords(nodeId, edges)`** in `upstreamRecords.ts` — shared utility used by all process runners. TYPED_HANDLES (`pdf`, `xml`, `text`, `image`, `csv`) use partitioned store keys `${sourceId}:${handle}`; all others use plain `sourceId`.
- **`useUpstreamRecords(nodeId)`** hook — same TYPED_HANDLES logic for reactivity; uses `${type}Count` key from node data.
- **`collectLineage(nodeId, nodes, edges)`** in `lineage.ts` — derive-on-demand pipeline history (docs/context-accrual.md). Walks the upstream subgraph over `data`/`results` target-handle edges (param handles are config, not data flow), applies `resolveProxyEdges` for collapsed groups, returns a topologically ordered `LineageGraph` with `stripTransient`'d params + counts read from raw data. Pure read — call from runners with `getNodes()`/`edges`, from components with `useNodes()`/`useEdges()` values. The `stale` flag is heuristic: an upstream node that never ran this session, or claims a `resultsVersion` its store no longer holds. **`lineageToNarrative(graph, {maxChars})`** (same file, default 2000 chars) renders it LLM-ready: linear chains as numbered lists, parallel branches as lettered sections with shared ancestors described once, joins under "Then:"; the budget drops earliest steps whole (never mid-sentence) and a stale graph gets an explicit warning prefix.
- **`describeNode(node)` / `lineageDescribers`** in `lineageDescribers.ts` — per-node-type one-sentence operation summaries for the lineage narrative; `satisfies Partial<Record<NodeTypeId, …>>` guard, generic label+counts fallback. Count keys are deliberately NOT uniform across runners (reconciliation `resolvedCount`/`reviewCount`, geocoding bare `resolved`/`pending`/`failed`, merge `mergedCount`/`unmatchedCount`, search `count`) — the describers pin the real names and `lineageDescribers.test.ts` fails if a runner renames one.

## Architectural Gotchas

1. `RECONCILE_API = '/reconcile-proxy/en/api'` — never use direct URL.
2. `TransformOp` discriminated union — replace entire op on type change; never patch.
3. `TableOutputNode` fingerprint `useRef` — prevents infinite loop; do not remove.
4. `allFlatColumns` needs `isReconciledValue` check — else reconciled columns excluded.
5. MDS capped at 200 by design. (The ADS nodes and their 50-record cap were removed Oct 2026; ADS records arrive via ARIADNESearch.)
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
18. `upstreamRecords.ts` `TYPED_HANDLES = Set(['pdf','xml','text','image','csv'])` — `results` and `data` are NOT in this set, so they fall through to plain `sourceId` lookup.
19. KCL node truncation via `getContentMaxChars(model)` from `kclConfig.ts` — not a hard-coded constant. In aggregate mode the budget goes to `aggregateFieldValues`, which truncates each value BEFORE joining and never cuts an `id:` heading in half; `included` is what the model really received, so `{{count}}` stays honest.
20. KCLFieldNode streaming returns accumulated full text (not empty string) from `kclChat`. In component `handleRun`, `liveTokens` state must NOT be in the `useCallback` deps array for non-streaming to work (stale closure is expected in that narrow context). Runner path stays non-streaming; partial results via per-record `setNodeResults`.
21. KCLFieldNode per-record mode: do NOT set `resultsVersion: 0` in the final `updateNodeData` after the loop — partial updates already track version correctly. Setting it to 0 resets reactivity and invisible results to downstream nodes.
22. CommentNode easter egg: click title 5 times within 1.5 seconds to unlock input/output handles for illustrating data-flow gaps.
23. `runMergeByQIDNode.ts` `extractQIDInfo` must handle **array-valued** `*_reconciled` fields, not just a single `ReconciliationResult | null` — a field can carry multiple candidate reconciliations. Always normalise with `Array.isArray(raw) ? raw : [raw]` before scanning for a resolved/review QID.
24. `TableOutputNode` column-resize drag handler: never re-read `resizingRef.current` more than once per `mousemove` after the initial null-check — cache it to a local (`const r = resizingRef.current; if (!r) return`) before use. Re-reading it later in the same handler risks a null dereference if the ref is cleared mid-drag (e.g. `mouseup` racing `mousemove`).
25. GBIF domain fields (`scientificName`, `kingdom`, …, `datasetName`, `eventDate`, `basisOfRecord`, `institutionCode`) exist ONLY under `record.gbif.*` — the adapter stores the raw occurrence wholesale and writes no flat copies. Readers use dot-notation (`gbif.scientificName`); `authoritiesForField` matches namespaced fields by last segment so typed authorities still apply. `periodStart/End/Name` are intentionally top-level — they are cross-service temporal fields written by three adapters, NOT domain-specific.
26. Run All (`runWorkflow.ts`) marks a node *failed* only when its runner throws. A runner that sets `status: 'error'` and returns (the contract) is counted as completed, so dependants still run against empty input. Backlog B13 in `docs/engineering-review.md`.
27. `resolveProxyEdges` (`upstreamRecords.ts`) restores only the `proxy-out` (source) side of collapsed-group edges. A node inside a collapsed group fed from outside gets no dependency, records or param value during Run All; `resolveSavedEdges` (`workflowIO.ts`) handles both sides for save/load. Backlog B14.
28. `minimised` on `sourceProfile` is NOT `collapsed`. `collapsed` is group-node semantics read by `withToolbar`, `useGrouping`, `useWorkflowIO`, `workflowIO` and `upstreamRecords` (all gated on `type === 'group'`); never reuse that key on a non-group node. `minimised` is plain persisted node data (not in `TRANSIENT_FIELDS`), pinned by `workflowIO.test.ts`.
29. Timeline date priority is `periodStart → date → gbif.eventDate` on purpose. ARIADNE/HSDS write the catalogue `issued` date into `date` AND the archaeological period into `periodStart`; with `date` first, a Stonehenge result set plotted in 2002–2020. No fixture record has a period without a date, so a *fallback* would have been a no-op — it had to be a priority. Change it only in `AUTO_DATE_FIELDS` (`dateUtils.ts`), which the component, the runner and the table badge all share. Periods wider than `MAX_PERIOD_SPAN_YEARS` (20,000 — ARIADNE's "prehistoric" -500000..43 and "palaeolithic" buckets, 5% of period records) are skipped in automatic mode and fall through to `date`, otherwise one record stretches the axis over half a million years; an explicit `dateField` bypasses the threshold, and the timeline's auto-scaled SVG width is capped at `MAX_SVG_W` as a backstop.
30. `vam.iiifImageBase` and `nhm.iiifInfo` are IIIF **Image API services**, not images. The bare base 404s ("neither a file nor part of an image sequence") and info.json is JSON. Never render or send the raw value — go through `resolveImageSrc`/`imageServiceUrl` (`iiifImage.ts`), which builds `${base}/full/${size}/0/default.jpg`. `IMAGE_KEYS` still lists them as image fields on purpose (they ARE the best-resolution image source); the resolver is what makes that safe.
31. SMG publishes a **valid but empty** IIIF manifest (`canvases: []`, `thumbnail.@id: ""`) for every object without digitised media, so `adaptSMGRecord` writes `smg.manifest` only when `smg.thumbnail` exists and `recordNormalise` strips it from legacy fixtures/saved searches. ImageView's "manifest lists no images — the object has no digitised media" error covers any straggler. Do not reintroduce the unconditional manifest: 22% of SMG entries in the IIIF picker were dead.
34. The capture thumbnail `_captureThumb` and the navigation keys `_captureEntryUrl` / `_captureEntryKind` / `_captureCanvasKey` are `_`-prefixed on purpose. `collectFieldPaths` (`fieldPaths.ts`) and `collectImageFieldCandidates` (`imageFields.ts`) skip `_`-prefixed keys; un-prefixed, the data-URL thumb AND the IIIF-looking manifest/service URLs were offered as image fields in the AI Inference Image picker and a downstream Image View (the first cut listed `captureEntryUrl` and `captureCanvasKey` there), letting a 160 px thumb or a bare service URL be sent to the model by accident. `content` is inserted before it in `buildCaptureRecord` so `buildUserContent` auto-detect still picks the full crop.
33. SMG's IIIF image server (`zoom.sciencemuseumgroup.org.uk`) returns **403** for almost every explicit size parameter — `!600,600`, `!1024,1024`, `!2400,2400`, `600,`, `pct:50` — while serving `max`, `!1200,1200` and sizes ≤ ~400 px, with an `info.json` that claims level2 (probed Nov 2026; same from the browser, `/image-proxy` and `/url-proxy`). Never assume a size parameter works for a service: fetch regions through `fetchIiifRegion` (which falls back to `max`) and let the viewer's `sizedRefused` fallback handle the zoom tiers. Before this, SMG region capture had never worked and failed silently.
32. Never add a local `SOURCE_COLORS` table to a node. Timeline, Map and Source Profile each had one (Nov 2026); they drifted (`va` vs `vam`, five keys vs sixteen) until six institutions rendered as the same indigo circle. `sourceIdentity.ts` is the only table — it pairs colour WITH shape so two sources never collide on both, and its fallback is a neutral grey so an unmapped source cannot pass for a real one. Adding a data source = adding one row there (and to the test's pinned key list).
