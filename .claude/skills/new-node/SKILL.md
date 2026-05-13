# /new-node

Scaffold a complete new node for the iDAH Federation workflow editor. Works from a brief description of what the node should do. Covers all registration steps, proxy config for both dev and production, and pushes to both branches.

Before starting, ask the user for (if not already provided):
- **Node name** (PascalCase, e.g. `PortalSearch`) — used for file and component names
- **Type key** (camelCase, e.g. `portalSearch`) — used as the React Flow node type identifier
- **Node kind**: `data-source` | `process` | `output` | `display-only`
- **Proxy needed?** If yes: prefix (e.g. `/portal-proxy`) and upstream URL
- **Has API key?** (should the node be in `KCL_API_KEY_NODES` for auto-population)
- **Group** for the sidebar (Canvas / Input / Inspection / Data Services / Local Content / Filters and Transforms / Extraction and Enrichment / Output)

Once confirmed, execute all steps. Run `tsc --noEmit` after each file is created.

---

## Step 1 — Runner (`src/utils/run<Name>Node.ts`)

*Skip for display-only nodes (QuickView, ImageView, Comment pattern) and nodes requiring user gestures (LocalFolderSource pattern).*

Implement the `NodeRunner` contract:

```typescript
export async function run<Name>Node(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as <Name>NodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  try {
    // … fetch / process …
    const version = setNodeResults(nodeId, records)
    updateNodeData(nodeId, {
      status: 'success',
      statusMessage: `✓ ${records.length} of ${total.toLocaleString()}`,
      count: total,
      resultsVersion: version,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    updateNodeData(nodeId, { status: 'error', statusMessage: `✗ ${msg}`, count: 0 })
  }
}
```

Rules:
- **Never throw** — always leave the node in `success` | `error` status.
- Use `clearNodeResults(nodeId)` first, then `setNodeResults(nodeId, records)` — never put record arrays in `updateNodeData`.
- The version integer returned by `setNodeResults` is the only reactivity signal — always store it as `resultsVersion`.
- Service fields go under a namespace: `record.<key>.*` (e.g. `record.gbif.*`).
- Set `_source: '<key>'` on every record so SourceProfile can identify it.
- If paginating, update `statusMessage` each page: `Page N/M (X fetched)…`.

## Step 2 — Register runner (`src/utils/nodeRunners.ts`)

Add an entry to the `nodeRunners` registry object:

```typescript
<typeKey>: (id, getNodes, edges, updateNodeData) =>
  run<Name>Node(id, getNodes, edges, updateNodeData),
```

Import the runner at the top of the file.

*Skip for display-only nodes.*

## Step 3 — Component (`src/nodes/<Name>Node.tsx`)

Create the React component. Follow the established patterns:

- Export `interface <Name>NodeData { … [key: string]: unknown }`
- Export `function <Name>Node({ id, data }: NodeProps)`
- Use `useReactFlow()` for `updateNodeData`; `useEdges()` for live edge state
- Input handle: `<Handle type="target" position={Position.Left} id="data" />`
- Output handle: `<Handle type="source" position={Position.Right} id="results" />` (green: `#22c55e`)
- Status badge in header showing `statusMessage`
- Border color driven by `status`: idle `#d1d5db` / loading `#3b82f6` / success `#22c55e` / error `#ef4444`
- Run button calls `nodeRunners.<typeKey>(id, getNodes, getEdgesSnap(), updateNodeData)`
- For pass-through nodes: include fingerprint `useRef` + `useEffect` guard to prevent infinite loops (see TableOutputNode pattern)
- For nodes with API keys: plain-text password input + eye toggle; do NOT persist key to localStorage

Common handle IDs for wirable inputs: `data`, `query`, `limit`, `apiKey`

## Step 4 — Register in node index (`src/nodes/index.ts`)

Add import and `withDuplicate` entry:

```typescript
import { <Name>Node } from './<Name>Node'
// … in nodeTypes object:
<typeKey>: withDuplicate(<Name>Node),
```

## Step 5 — App.tsx: data type union

Find the `AppNode` type union (the block of `| Node<…Data>` lines) and add:

```typescript
| Node<<Name>NodeData>
```

Import the data type at the top where other node data types are imported.

## Step 6 — App.tsx: NODE_DEFAULTS factory

Add to the `NODE_DEFAULTS` object with sensible defaults. All fields from the node's data interface must be present:

```typescript
<typeKey>: pos => ({
  id: newId('<prefix>'), type: '<typeKey>', position: pos,
  data: {
    // … all fields with defaults …
    status: 'idle', statusMessage: '', count: 0, resultsVersion: 0,
  } satisfies <Name>NodeData,
}),
```

Naming convention for `newId` prefix: short lowercase abbreviation of the node name.

## Step 7 — App.tsx: SIDEBAR_ITEMS

Add to `SIDEBAR_ITEMS` in the appropriate group:

```typescript
{ type: '<typeKey>', label: '<Display Name>', sub: '<one-line description>', color: '<header hex>', group: '<Group>' },
```

Add `hidden: true` if the node should not appear in the sidebar by default (e.g. legacy/Ollama nodes).

## Step 8 — App.tsx: KCL_API_KEY_NODES (conditional)

If the node has an `apiKey` field, add `'<typeKey>'` to the `KCL_API_KEY_NODES` Set so new instances are pre-populated from any existing key on the canvas.

## Step 9 — ConnectionSuggestions (`src/components/ConnectionSuggestions.tsx`)

Add the node to the appropriate set so the connection-suggestion popup knows what to offer downstream:

| Node kind | Set to add to |
|-----------|--------------|
| Data source | `DATA_SOURCES` |
| Process / transform | `PROCESS_NODES` |
| Inference (uses KCL API) | `INFERENCE_NODES` |
| Pass-through output | `PASS_THROUGH` |

If the node accepts wired `query` / `limit` / `apiKey` handles from a Param node, add it to `NODE_PARAM_HANDLES` with the handle IDs and labels, and to the `param` suggestion list in `SUGGESTIONS.param`.

If it should appear as a suggestion downstream of data sources or process nodes, add it to `OUTPUT_SUITE` or `ENRICH_SUITE` as appropriate.

## Step 10 — Proxy: Vite dev (`vite.config.ts`)

*Skip if no proxy needed.*

Add to the `proxy` object inside `server`:

```typescript
'/<prefix>-proxy': {
  target: 'https://upstream.example.com',
  changeOrigin: true,
  rewrite: path => path.replace(/^\/<prefix>-proxy/, ''),
  // Add headers if needed for User-Agent spoofing or Referer:
  headers: {
    'User-Agent': '…',
    'Referer': 'https://upstream.example.com/',
  },
},
```

## Step 11 — Proxy: Express production (`server/index.mjs` on deploy branch)

*Skip if no proxy needed.*

**This step must be done on the `deploy/express-server` branch.** After all other steps are committed to `main`:

```
git checkout deploy/express-server
git merge main --no-edit
```

Then add to `server/index.mjs`, before the `app.use(adsLibrarySearchMiddleware)` line:

```js
app.use('/<prefix>-proxy', createProxyMiddleware({
  target: 'https://upstream.example.com',
  changeOrigin: true,
  pathRewrite: { '^/<prefix>-proxy': '' },
  on: {
    proxyReq: (proxyReq) => {
      stripEncoding(proxyReq)
      // replicate any custom headers from vite.config.ts:
      proxyReq.setHeader('User-Agent', DESKTOP_UA)
      proxyReq.setHeader('Referer', 'https://upstream.example.com/')
    },
  },
}))
```

## Step 12 — TypeScript check

```
npx tsc --noEmit 2>&1 | head -30
```

Fix all errors before committing.

## Step 13 — Commit and push both branches

```
git add <all changed files>
git commit -m "feat: add <Name>Node — <one-line description>"
git push origin main
git checkout deploy/express-server
git merge main --no-edit
git push origin deploy/express-server
git checkout main
```

---

## Checklist summary

- [ ] `src/utils/run<Name>Node.ts` (runner)
- [ ] `src/utils/nodeRunners.ts` (runner registered)
- [ ] `src/nodes/<Name>Node.tsx` (component)
- [ ] `src/nodes/index.ts` (component registered)
- [ ] `src/App.tsx` — AppNode union
- [ ] `src/App.tsx` — NODE_DEFAULTS
- [ ] `src/App.tsx` — SIDEBAR_ITEMS
- [ ] `src/App.tsx` — KCL_API_KEY_NODES (if apiKey)
- [ ] `src/components/ConnectionSuggestions.tsx`
- [ ] `vite.config.ts` (if proxy)
- [ ] `server/index.mjs` on deploy branch (if proxy)
- [ ] `tsc --noEmit` clean
- [ ] Committed and pushed to both branches
