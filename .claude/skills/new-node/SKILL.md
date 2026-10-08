# /new-node

Scaffold a complete new node for the iDAH Federation workflow editor. Works from a brief description of what the node should do. Covers all registration steps and proxy config (one `server/proxies.mjs` serves both dev and production).

Before starting, ask the user for (if not already provided):
- **Node name** (PascalCase, e.g. `PortalSearch`) — used for file and component names
- **Type key** (camelCase, e.g. `portalSearch`) — used as the React Flow node type identifier
- **Node kind**: `data-source` | `process` | `output` | `display-only`
- **Proxy needed?** If yes: prefix (e.g. `/portal-proxy`) and upstream URL
- **Has API key?** (should the node be in `KCL_API_KEY_NODES` for auto-population)
- **Group** for the sidebar (Workflow Planning / Discovering / Gathering / Enriching / Analysing / Visualising / Disseminating / Experimental — see `SIDEBAR_GROUPS` in `src/config/sidebarItems.ts`)

Once confirmed, execute all steps. Run `npm run typecheck` after each file is created.

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

Add import and `withToolbar` entry:

```typescript
import { <Name>Node } from './<Name>Node'
// … in nodeTypes object:
<typeKey>: withToolbar(<Name>Node),
```

## Step 5 — `src/types/AppNode.ts`: data type union

Find the `AppNode` type union (the block of `| Node<…Data>` lines) and add:

```typescript
| Node<<Name>NodeData>
```

Import the data type at the top where other node data types are imported.

## Step 6 — `src/config/nodeDefaults.ts`: NODE_DEFAULTS factory

Add to the `NODE_DEFAULTS` object (it is checked with `satisfies Partial<Record<NodeTypeId, …>>`, so a typo'd key is a compile error) with sensible defaults. All fields from the node's data interface must be present:

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

## Step 7 — `src/config/sidebarItems.ts`: SIDEBAR_ITEMS

Add to `SIDEBAR_ITEMS` in the appropriate group (the `color` must match the node's `NODE_IDENTITY` entry in `src/styles/theme.ts`):

```typescript
{ type: '<typeKey>', label: '<Display Name>', sub: '<one-line description>', color: '<header hex>', group: '<Group>' },
```

Add the type to `ADVANCED_TYPES` (same file) if it should be hidden in Simple mode, and set `alpha: true` for Experimental-group nodes.

## Step 8 — `src/config/nodeDefaults.ts`: KCL_API_KEY_NODES (conditional)

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

## Step 10 — Proxy: `PROXY_TABLE` in `server/proxies.mjs`

*Skip if no proxy needed.*

Add one entry to `PROXY_TABLE`. That file is imported by both `vite.config.ts` (dev) and
`server/index.mjs` (Docker), so the route is live in both without any further wiring:

```javascript
{
  prefix:  '/<prefix>-proxy',
  target:  'https://upstream.example.com',
  rewrite: path => path.replace(/^\/<prefix>-proxy/, ''),
  // Optional — only if the upstream needs a browser-like User-Agent or Referer:
  headers: { 'User-Agent': DESKTOP_UA, 'Referer': 'https://upstream.example.com/' },
},
```

Do **not** add routes to `vite.config.ts` directly. Custom middleware (anything beyond a
reverse proxy) is exported from `proxies.mjs` and registered in both consumers — see
`urlProxyMiddleware`. Then add the row to the proxy table in `CLAUDE.md`.

## Step 11 — Theme, describer, QuickStart

- Colour: add the type to `NODE_IDENTITY` in `src/styles/theme.ts` (same hex as the sidebar entry).
- Lineage: add a one-line describer in `src/utils/lineageDescribers.ts` (else the generic fallback is used).
- If QuickStart should be able to plan the node: the type lists in `src/nodes/QuickStartNode.tsx`.

## Step 12 — TypeScript check

```
npm run typecheck
```

Fix all errors before committing.

## Step 13 — Commit

One conventional commit on a feature branch; run `npm run lint`, `npm run typecheck`, `npx vitest run` and `npx vite build` first (CI runs the same four gates).

## Checklist summary

- [ ] `src/utils/run<Name>Node.ts` (runner)
- [ ] `src/utils/nodeRunners.ts` (runner registered)
- [ ] `src/nodes/<Name>Node.tsx` (component)
- [ ] `src/nodes/index.ts` (component registered)
- [ ] `src/types/AppNode.ts` — AppNode union
- [ ] `src/config/nodeDefaults.ts` — NODE_DEFAULTS (+ KCL_API_KEY_NODES if apiKey)
- [ ] `src/config/sidebarItems.ts` — SIDEBAR_ITEMS (+ ADVANCED_TYPES if hidden in Simple mode)
- [ ] `src/styles/theme.ts` — NODE_IDENTITY colour
- [ ] `src/utils/lineageDescribers.ts` — describer
- [ ] `src/components/ConnectionSuggestions.tsx`
- [ ] `PROXY_TABLE` entry in `server/proxies.mjs` (if proxy) — serves dev and Docker
- [ ] `npm run typecheck` clean
- [ ] Committed on a feature branch with all four gates green
