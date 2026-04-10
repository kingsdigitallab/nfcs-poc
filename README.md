# iDAH Federation Workflow PoC

A node-based visual workflow editor for federating UK Arts & Humanities research data services. Built as part of the UKRI/AHRC Federation of Compute and Infrastructures programme.

Drag source nodes onto a canvas, connect them to output nodes, and run federated searches across multiple heritage data services simultaneously. Results from different services are normalised to a common format and can be viewed side-by-side in a shared table.

![Canvas showing GBIF and ADS nodes connected to a TableOutputNode](docs/screenshot.png)

---

## Prerequisites

- **Node.js** v18 or later ([nodejs.org](https://nodejs.org))
- **npm** v9 or later (bundled with Node)
- A modern browser (Chrome, Firefox, Edge)

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/kingsdigitallab/nfcs-poc.git
cd nfcs-poc

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

Then open **http://localhost:5174** in your browser.

> The port is fixed at 5174 to avoid conflicts with other Vite projects. If something is already on that port, stop it first.

---

## Project structure

```
nfcs-poc/
├── CLAUDE.md               # API references and architecture notes
├── vite.config.ts          # Dev server + CORS proxy rules
└── src/
    ├── App.tsx             # Canvas, sidebar, Run All button
    ├── types/
    │   └── UnifiedRecord.ts        # Canonical cross-service record type
    ├── hooks/
    │   └── useUpstreamRecords.ts   # Reactive multi-source data hook
    ├── nodes/                      # React Flow node components
    │   ├── ParamNode.tsx
    │   ├── GBIFSearchNode.tsx
    │   ├── LLDSSearchNode.tsx
    │   ├── ADSSearchNode.tsx
    │   ├── TableOutputNode.tsx
    │   ├── JSONOutputNode.tsx
    │   └── ExpandedOutputPanel.tsx
    └── utils/                      # Adapters, runners, workflow executor
        ├── gbifAdapter.ts
        ├── lldsAdapter.ts / lldsCache.ts
        ├── adsAdapter.ts
        ├── runGBIFNode.ts / runLLDSNode.ts / runADSNode.ts
        ├── nodeRunners.ts          # Registry: node type → runner function
        └── runWorkflow.ts          # Topological executor for Run All
```

---

## Available node types

| Category | Node | Description |
|----------|------|-------------|
| Input | **ParamNode** | Holds a Text or Integer value. Connect its output handle to any search node input handle to supply a parameter. |
| Source | **GBIFSearchNode** | Searches the [GBIF Occurrence API](https://www.gbif.org/developer/occurrence). Returns biodiversity specimen and observation records. No proxy needed. |
| Source | **LLDSSearchNode** | Searches the [Literary and Linguistic Data Service](https://llds.ling-phil.ox.ac.uk/) via DSpace REST. Results are filtered client-side. Uses a localStorage cache with a 24-hour TTL and a "use cache" toggle for resilience during outages. |
| Source | **ADSSearchNode** | Searches the [Archaeology Data Service](https://archaeologydataservice.ac.uk/) Data Catalogue API. Returns archaeological datasets with spatial and temporal coverage. |
| Source | **MDSSearchNode** | Scrapes [museumdata.uk](https://museumdata.uk/) search results (no public JSON API). Results are capped at 200 per search. An amber ⚠ badge appears when the total exceeds the cap. |
| Output | **TableOutputNode** | Displays results in a paginated table. Accepts connections from multiple source nodes and merges their records. Double-click to expand to a full-screen panel. |
| Output | **JSONOutputNode** | Displays the raw normalised records as syntax-highlighted JSON. Double-click to expand. |

---

## Usage examples

### Example 1 — Simple GBIF search

1. Drag a **ParamNode** from the sidebar onto the canvas
2. Set type to **Text**, value to `Quercus robur`
3. Drag a **GBIFSearchNode** onto the canvas
4. Draw an edge from the ParamNode's output (right handle) to the `scientificName` input on the GBIF node
5. Type `GB` directly into the `country` inline field on the GBIF node
6. Drag a **TableOutputNode** onto the canvas
7. Draw an edge from the GBIF node's output to the TableOutputNode's input
8. Click **▶ Run** on the GBIF node — the table populates with oak records from Great Britain

---

### Example 2 — Parallel multi-service search

Run a search term across two services simultaneously and view merged results in one table.

1. Drag a **ParamNode** — set value to `Stonehenge`
2. Drag a **GBIFSearchNode** — connect the ParamNode to its `q` input handle
3. Drag an **ADSSearchNode** — connect the same ParamNode to its `query` input handle
4. Drag a **TableOutputNode** — connect **both** search node outputs to its single input handle
5. Click **▶▶ Run All** in the top bar

Both searches fire in parallel. The table header shows e.g. **"18 rows · 2 sources"**. The `_source` column identifies which service each row came from (`gbif` or `ads`).

---

### Example 3 — Using the Run All button with a mixed workflow

The **▶▶ Run All** button in the top bar discovers all runnable nodes (GBIF, LLDS, ADS) and executes them in topological order — source nodes first, processing nodes after their upstream dependencies complete. If one node fails or times out, the rest of the workflow continues unaffected.

1. Build any combination of source and output nodes on the canvas
2. Wire them up
3. Press **▶▶ Run All** — all source nodes fire in parallel, output nodes update reactively as results arrive

---

### Example 5 — Museum Data Service search

1. Drag an **MDSSearchNode** onto the canvas
2. Type a search term (e.g. `Roman coin`) into the `q` field and set `limit` to `50`
3. Connect its output to a **TableOutputNode**
4. Click **▶ Run** — the node fetches museumdata.uk in two steps: first to read the total hit count, then to retrieve all records at once
5. If the total exceeds your limit or the 200-record cap, the status badge turns amber: `⚠ 50 of 312 (capped)`
6. The `_source` column shows `mds`; the `mds.*` namespace in the JSON output contains the full field map (condition, materials, dimensions, provenance, etc.)

---

### Example 4 — Expanding a table for full-screen browsing

1. Run a workflow that produces table results
2. **Double-click** a TableOutputNode — an expanded panel slides in from the right
3. Use the **show all columns** toggle to reveal service-specific fields
4. Navigate pages with Prev / Next
5. Click **✕** to close the panel

---

## CORS and the dev proxy

GBIF has permissive CORS headers so the browser can fetch it directly. LLDS and ADS do not, so the Vite dev server proxies those requests server-side:

| Prefix | Target |
|--------|--------|
| `/llds-proxy/...` | `https://llds.ling-phil.ox.ac.uk/llds/...` |
| `/ads-proxy/...` | `https://archaeologydataservice.ac.uk/...` |
| `/mds-proxy/...` | `https://museumdata.uk/...` |

This proxy is **development-only**. For a production deployment you would replace these with a lightweight server-side proxy (a Cloudflare Worker, a single Express route, or similar).

---

## Adding a new data source

1. Create `src/utils/<service>Adapter.ts` — maps the raw API response to `UnifiedRecord[]`
2. Create `src/utils/run<Service>Node.ts` — fetches the API and calls the adapter, conforms to the `NodeRunner` signature
3. Create `src/nodes/<Service>SearchNode.tsx` — React Flow node component
4. Register in `src/utils/nodeRunners.ts` — one line
5. Register in `src/nodes/index.ts` — one line
6. Add factory + sidebar entry in `src/App.tsx`
7. If the service lacks CORS headers, add a proxy rule to `vite.config.ts`

Output nodes (`TableOutputNode`, `JSONOutputNode`) require **no changes** — they consume `UnifiedRecord[]` regardless of source.

---

## Tech stack

- [Vite](https://vitejs.dev/) + [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [@xyflow/react v12](https://reactflow.dev/) — node-based canvas
- No backend, no database, no authentication
