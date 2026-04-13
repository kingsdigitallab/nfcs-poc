# iDAH Federation Workflow PoC

A node-based visual workflow editor for federating UK Arts & Humanities research data services. Built as part of the UKRI/AHRC Federation of Compute and Infrastructures programme.

Drag nodes onto a canvas, connect them in any order, and run federated searches across multiple heritage data services simultaneously. Records from different services are normalised to a common schema, can be filtered and transformed, reconciled against Wikidata authorities, and exported as CSV, JSON, or GeoJSON.

---

## Prerequisites

- **Node.js** v18 or later ([nodejs.org](https://nodejs.org))
- **npm** v9 or later (bundled with Node)
- A modern browser (Chrome, Firefox, Edge)

---

## Installation

```bash
git clone https://github.com/kingsdigitallab/nfcs-poc.git
cd nfcs-poc
npm install
npm run dev
```

Open **http://localhost:5174** in your browser.

> The port is fixed at 5174 to avoid conflicts with other Vite projects.

---

## Node types

The sidebar groups nodes into four categories. Drag any node onto the canvas to add it.

### Input

| Node | Description |
|------|-------------|
| **ParamNode** | Holds a Text or Integer value. Connect its output handle to any search node input handle to inject a query parameter. |

### Source

| Node | Service | Notes |
|------|---------|-------|
| **GBIFSearchNode** | [GBIF Occurrence API](https://www.gbif.org/developer/occurrence) | Biodiversity specimens and observations. Direct browser fetch (permissive CORS). Inline fields: free-text `q`, `scientificName`, `country`, `year`, `limit`. |
| **LLDSSearchNode** | [Literary & Linguistic Data Service](https://llds.ling-phil.ox.ac.uk/) | HTML scraper of the DSpace discover page. Results filtered client-side. Uses a 24-hour localStorage cache; a **Use cache** toggle controls fallback during outages. |
| **ADSSearchNode** | [Archaeology Data Service](https://archaeologydataservice.ac.uk/) | Data Catalogue API. Returns archaeological datasets with spatial/temporal coverage. Routed through the Vite proxy. |
| **MDSSearchNode** | [museumdata.uk](https://museumdata.uk/) | HTML scraper (no public JSON API). Two-step fetch: probe for total, then retrieve all. Capped at 200 records; amber ⚠ badge when the total exceeds the cap. |

### Process

Process nodes sit between source nodes and output nodes. They read upstream `results`, transform or reduce the records, and pass the augmented array downstream.

| Node | Description |
|------|-------------|
| **FilterTransformNode** | Filters records by condition and/or mutates field values. See [Filter / Transform](#filter--transform) below. |
| **ReconciliationNode** | Reconciles a chosen field against a Wikidata authority. See [Reconciliation](#reconciliation) below. |

### Output

| Node | Description |
|------|-------------|
| **TableOutputNode** | Paginated table. Merges records from multiple upstream nodes automatically. Toggle **show all columns** to reveal service-specific fields. Pass-through output handle so it can chain into Map, Timeline, or Export nodes. Double-click to expand to a full-screen panel. |
| **JSONOutputNode** | Syntax-highlighted JSON viewer. Shows the full normalised record graph including namespace fields. Double-click to expand. |
| **MapOutputNode** | Leaflet map. Plots any record that has `decimalLatitude` and `decimalLongitude`. Each source service gets a distinct colour. Click a marker for a popup with title, date, and a link back to the source record. |
| **TimelineOutputNode** | SVG horizontal timeline at year resolution. Handles ISO dates, bare years, and BCE dates (e.g. `-1199`). Each source gets a distinct marker shape. Hover a marker for details. Scrollable for wide date ranges. |
| **ExportNode** | Downloads the upstream records as **CSV**, **JSON**, or **GeoJSON**. See [Export](#export) below. |

---

## Data flow

```
ParamNode ─┐
           ▼
  GBIFSearchNode ──────────────────────────────────┐
  LLDSSearchNode ──────────────────────────────────┤
  ADSSearchNode  ──┐                               │
  MDSSearchNode  ──┤                               │
                   ▼                               │
         FilterTransformNode ─────────────────────┤
                   │                               │
                   ▼                               │
         ReconciliationNode  ─────────────────────┤
                                                   ▼
                                          TableOutputNode ──► ExportNode
                                          JSONOutputNode
                                          MapOutputNode
                                          TimelineOutputNode
```

All nodes expose a **`data` input handle** (left) and a **`results` output handle** (right). You can chain them in any order and branch to multiple output nodes simultaneously.

The `useUpstreamRecords` hook merges records from **all** edges connected to a node's input handle, so a single Table or Map node can aggregate several source nodes at once.

---

## Execution model

- **▶ Run** (on individual source/process nodes) — execute that node only.
- **▶▶ Run All** (top bar) — discovers every runnable node, builds a topological order using Kahn's algorithm, and executes nodes wave-by-wave: all source nodes in parallel first, then each processing layer in dependency order. If one node errors, the rest continue.

---

## The UnifiedRecord schema

Every adapter maps its raw API response to `UnifiedRecord` before writing to the canvas. Output nodes consume only `UnifiedRecord[]` — they never touch raw responses.

```
id            — globally unique, service-prefixed: "gbif:12345", "ads:1862953"
_source       — service identifier: "gbif" | "llds" | "ads" | "mds"
_sourceId     — native record ID within the service
_sourceUrl    — link back to the record in the service's own UI
_pid          — persistent identifier (DOI, Handle, ARK) when available
_cached       — true when served from localStorage cache

title         — best available display title
description   — abstract or description
creator       — author(s) — string or string[]
date          — publication or event date
subject       — subject keywords — string or string[]
language      — language code, e.g. "en"
type          — resource type, e.g. "Dataset", "Text"

scientificName, country, eventDate          — GBIF-specific normalised fields
decimalLatitude, decimalLongitude           — used by MapOutputNode
basisOfRecord, institutionCode, datasetName — GBIF-specific

gbif.*   — full raw GBIF occurrence object
llds.*   — LLDS handle, branding, itemType
ads.*    — ADS temporal, country, spatial, identifier namespace
mds.*    — MDS field map (condition, materials, dimensions, provenance, …)
```

After reconciliation, records also carry `${fieldName}_reconciled` keys (see below).

---

## Filter / Transform

**FilterTransformNode** operates in three modes (selectable via tabs):

### Filter mode

Add one or more filter rows. Each row specifies:
- **Field** — any string field from the upstream records
- **Operator** — `contains`, `=`, `starts with`, `>`, `<`, `is empty`, `not empty`
- **Value** — text or number (hidden for `is empty` / `not empty`)

Multiple rows are combined with an **AND / OR** toggle. Clicking the pill between rows (or the badge in the section header) switches the combinator for all rows.

### Transform mode

Add one or more transform operations applied in order:

| Operation | What it does |
|-----------|--------------|
| **Rename field** | Copies a field to a new key. Optional **drop** checkbox removes the original. |
| **Lowercase / Uppercase** | In-place case conversion. Array values (`creator`, `subject`) are converted element-by-element. |
| **Truncate** | Trims a field to a maximum character length and appends `…`. |
| **Extract** | Slices a substring by start/end index, or captures a regex match (group 1 if present). Writes to a new field. |
| **Concatenate** | Merges two fields into a new key with a configurable separator. |

### Both mode

Filter runs first, then transforms are applied to the reduced set.

After running, the footer shows **N in → N out** so you can immediately see how many records were retained.

---

## Reconciliation

**ReconciliationNode** enriches a chosen field by matching its unique values against a Wikidata authority in a single batched POST to the [W3C Reconciliation API](https://www.w3.org/community/reports/reconciliation/CG-FINAL-specs-0.2-20230410/).

1. Connect an upstream node to the `data` handle.
2. Select the **field** to reconcile (dropdown populated from the first upstream record).
3. Select the **authority** — options depend on the field:

| Field | Authorities |
|-------|-------------|
| `creator` | Wikidata People (Q5), VIAF *(coming soon)* |
| `country`, `spatialCoverage` | Wikidata Places (Q618123), GeoNames *(coming soon)* |
| `scientificName`, `species`, `genus` | Wikidata Taxa (Q16521) |
| `subject`, `title` | Wikidata Items |
| `institutionCode` | Wikidata Organisations (Q43229) |
| *(any other field)* | Wikidata Items |

4. Set the **confidence threshold** (0.5–1.0, default 0.8). Records whose top candidate scores above the threshold are marked `resolved`; others are marked `review` but still passed through.
5. Click **▶ Reconcile**. Unique field values are batched into a single API call (capped at 200 values).

Each augmented record gains a `${fieldName}_reconciled` key with this shape:

```json
{
  "qid":         "Q23571040",
  "label":       "Quercus robur",
  "description": "species of flowering plant",
  "confidence":  0.92,
  "status":      "resolved",
  "candidates":  [{ "qid": "Q23571040", "label": "Quercus robur", "score": 0.92 }, …],
  "authority":   "wikidata-taxon"
}
```

In **TableOutputNode** and the expanded panel, reconciled cells render as coloured pills:
- 🟢 **Green** — resolved (confidence ≥ threshold). The QID is a clickable link to `wikidata.org`.
- 🟡 **Amber** — below threshold, flagged for review.

---

## Export

**ExportNode** downloads the upstream records. Select format from the dropdown:

| Format | Description |
|--------|-------------|
| **CSV** | Flat table, one row per record. `*_reconciled` objects are expanded to `_qid`, `_label`, `_confidence`, `_status` columns. Namespace objects (`gbif`, `llds`, `ads`, `mds`) are excluded. Values containing commas or quotes are properly escaped. |
| **JSON** | Full record graph as a pretty-printed JSON array, including all namespace fields and reconciled objects verbatim. |
| **GeoJSON** | `FeatureCollection` of records that have both `decimalLatitude` and `decimalLongitude`. Properties are flattened the same way as CSV. The node shows *N mappable / M total* before you download. |

Files are named `nfcs-export-YYYY-MM-DD.{ext}`. A **✓ saved** badge confirms each download.

---

## CORS and the dev proxy

GBIF and the Wikidata reconciliation endpoint have permissive CORS headers. The other services do not; the Vite dev server proxies those requests server-side:

| Prefix | Target |
|--------|--------|
| `/llds-proxy/…` | `https://llds.ling-phil.ox.ac.uk/llds/…` |
| `/ads-proxy/…` | `https://archaeologydataservice.ac.uk/…` |
| `/mds-proxy/…` | `https://museumdata.uk/…` |
| `/reconcile-proxy/…` | `https://wikidata.reconci.link/…` |

> **Production note:** This proxy is development-only. For a deployed instance, replace each rule with a lightweight server-side proxy — a Cloudflare Worker, a single Express route, or equivalent.

---

## Usage examples

### Federated search across two services

1. Drag a **GBIFSearchNode** and an **ADSSearchNode** onto the canvas.
2. Type `Stonehenge` into the inline query fields on both.
3. Drag a **TableOutputNode** and connect both search node outputs to its input.
4. Click **▶▶ Run All**. Both searches run in parallel; the table shows merged results with a `_source` column identifying each origin.

### Species reconciliation workflow

1. Run a **GBIFSearchNode** to get occurrence records.
2. Connect to a **ReconciliationNode**. Select field `scientificName`, authority `Wikidata Taxa`.
3. Connect the reconciliation node's output to a **TableOutputNode**. The `scientificName_reconciled` column shows green QID pills for high-confidence matches.
4. Connect an **ExportNode** set to **GeoJSON** to download mappable reconciled records.

### Filter then map

1. Run any source node to get records.
2. Connect to a **FilterTransformNode** in Filter mode. Add a row: `country` → `=` → `GB`.
3. Connect the filter node's output to a **MapOutputNode**. Only UK records appear on the map.

### Building a complete pipeline

```
GBIFSearchNode
      │
      ▼
FilterTransformNode  (filter: country = GB)
      │
      ▼
ReconciliationNode   (reconcile: scientificName → Wikidata Taxa)
      │
      ├──► TableOutputNode  (browse + expand)
      ├──► MapOutputNode    (spatial view)
      ├──► TimelineOutputNode (temporal view)
      └──► ExportNode       (CSV download)
```

---

## Project structure

```
nfcs-poc/
├── CLAUDE.md                   # API references and architecture notes (dev only)
├── vite.config.ts              # Dev server + CORS proxy rules
└── src/
    ├── App.tsx                 # Canvas, sidebar, Run All button, node factories
    ├── types/
    │   └── UnifiedRecord.ts    # Canonical cross-service record type
    ├── hooks/
    │   └── useUpstreamRecords.ts   # Reactive multi-source merge hook
    ├── nodes/                  # React Flow node components
    │   ├── index.ts            # nodeTypes registry
    │   ├── ParamNode.tsx
    │   ├── GBIFSearchNode.tsx
    │   ├── LLDSSearchNode.tsx
    │   ├── ADSSearchNode.tsx
    │   ├── MDSSearchNode.tsx
    │   ├── FilterTransformNode.tsx
    │   ├── ReconciliationNode.tsx
    │   ├── ReconciledCell.tsx      # Shared QID pill component
    │   ├── TableOutputNode.tsx
    │   ├── JSONOutputNode.tsx
    │   ├── MapOutputNode.tsx
    │   ├── TimelineOutputNode.tsx
    │   ├── ExportNode.tsx
    │   └── ExpandedOutputPanel.tsx
    └── utils/                  # Adapters, runners, pure utilities
        ├── gbifAdapter.ts
        ├── lldsAdapter.ts / lldsCache.ts
        ├── adsAdapter.ts
        ├── mdsAdapter.ts
        ├── reconciliationService.ts    # W3C Reconciliation API client
        ├── filterTransformUtils.ts     # Pure filter/transform functions
        ├── exportUtils.ts              # CSV / JSON / GeoJSON serialisers
        ├── runGBIFNode.ts
        ├── runLLDSNode.ts
        ├── runADSNode.ts
        ├── runMDSNode.ts
        ├── runReconciliationNode.ts
        ├── runFilterTransformNode.ts
        ├── nodeRunners.ts              # Registry: node type → runner
        └── runWorkflow.ts              # Topological executor (Kahn's algorithm)
```

---

## Adding a new data source

1. Create `src/utils/<service>Adapter.ts` — maps the raw API response to `UnifiedRecord[]`.
2. Create `src/utils/run<Service>Node.ts` — fetches the API, calls the adapter, conforms to the `NodeRunner` signature. Must never throw.
3. Create `src/nodes/<Service>SearchNode.tsx` — React Flow node component.
4. Register in `src/utils/nodeRunners.ts` — one line.
5. Register in `src/nodes/index.ts` — one line.
6. Add factory + sidebar entry in `src/App.tsx`.
7. If the service lacks permissive CORS headers, add a proxy rule to `vite.config.ts`.

All existing output nodes require **no changes** — they consume `UnifiedRecord[]` regardless of source.

---

## Tech stack

| Library | Purpose |
|---------|---------|
| [Vite](https://vitejs.dev/) | Dev server, bundler, CORS proxy |
| [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | UI framework |
| [@xyflow/react v12](https://reactflow.dev/) | Node-based canvas |
| [Leaflet](https://leafletjs.com/) | Map rendering in MapOutputNode |

No backend. No database. No authentication. All API calls are made directly from the browser (or via the Vite dev proxy for services without permissive CORS).
