import { useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type XYPosition,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { ExpandedOutputPanel } from './nodes/ExpandedOutputPanel'
import { runWorkflow } from './utils/runWorkflow'
import type { UnifiedRecord } from './types/UnifiedRecord'
import type { LLDSSearchNodeData }        from './nodes/LLDSSearchNode'
import type { ADSSearchNodeData }         from './nodes/ADSSearchNode'
import type { MDSSearchNodeData }         from './nodes/MDSSearchNode'
import type { ReconciliationNodeData }    from './nodes/ReconciliationNode'
import type { ExportNodeData }            from './nodes/ExportNode'

// ─── node data types (kept slim here; full types live in each node file) ─────

interface ParamNodeData  { label: string; paramType: string; value: string; [k: string]: unknown }
interface SearchNodeData { status: string; statusMessage: string; results?: UnifiedRecord[]; count?: number; [k: string]: unknown }
interface OutputNodeData { [k: string]: unknown }

type AppNode =
  | Node<ParamNodeData>
  | Node<SearchNodeData>
  | Node<LLDSSearchNodeData>
  | Node<ADSSearchNodeData>
  | Node<MDSSearchNodeData>
  | Node<ReconciliationNodeData>
  | Node<ExportNodeData>
  | Node<OutputNodeData>

// ─── node factories ───────────────────────────────────────────────────────────

let nodeIdCounter = 1
function newId(prefix: string) { return `${prefix}-${nodeIdCounter++}` }

const NODE_DEFAULTS: Record<string, (pos: XYPosition) => AppNode> = {
  param: pos => ({
    id: newId('param'), type: 'param', position: pos,
    data: { label: 'Parameter', paramType: 'Text', value: '' },
  }),
  gbifSearch: pos => ({
    id: newId('gbif'), type: 'gbifSearch', position: pos,
    data: {
      inlineQ: '', inlineScientificName: '', inlineCountry: '',
      inlineYear: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
  }),
  lldsSearch: pos => ({
    id: newId('llds'), type: 'lldsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      useCache: true,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies LLDSSearchNodeData,
  }),
  adsSearch: pos => ({
    id: newId('ads'), type: 'adsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies ADSSearchNodeData,
  }),
  mdsSearch: pos => ({
    id: newId('mds'), type: 'mdsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    } satisfies MDSSearchNodeData,
  }),
  reconciliation: pos => ({
    id: newId('recon'), type: 'reconciliation', position: pos,
    data: {
      selectedField:       '',
      selectedAuthority:   '',
      confidenceThreshold: 0.8,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      count:               0,
      resolvedCount:       0,
      reviewCount:         0,
    } satisfies ReconciliationNodeData,
  }),
  export: pos => ({
    id: newId('export'), type: 'export', position: pos,
    data: { format: 'csv' } satisfies ExportNodeData,
  }),
  tableOutput: pos => ({
    id: newId('table'), type: 'tableOutput', position: pos,
    data: {},
  }),
  jsonOutput: pos => ({
    id: newId('json'), type: 'jsonOutput', position: pos,
    data: {},
  }),
  mapOutput: pos => ({
    id: newId('map'), type: 'mapOutput', position: pos,
    data: {},
  }),
  timelineOutput: pos => ({
    id: newId('timeline'), type: 'timelineOutput', position: pos,
    data: {},
  }),
}

// ─── sidebar definition ───────────────────────────────────────────────────────

const SIDEBAR_ITEMS = [
  { type: 'param',       label: 'ParamNode',        sub: 'Text / Integer value',      color: '#3b82f6', group: 'Input' },
  { type: 'gbifSearch',  label: 'GBIFSearchNode',   sub: 'GBIF occurrence search',    color: '#0f4c81', group: 'Source' },
  { type: 'lldsSearch',  label: 'LLDSSearchNode',   sub: 'Lit. & Linguistic Data',    color: '#92400e', group: 'Source' },
  { type: 'adsSearch',   label: 'ADSSearchNode',    sub: 'Archaeology Data Service',  color: '#7c2d12', group: 'Source' },
  { type: 'mdsSearch',      label: 'MDSSearchNode',      sub: 'Museum Data Service',        color: '#1e3a8a', group: 'Source' },
  { type: 'reconciliation', label: 'ReconciliationNode', sub: 'Wikidata field reconciler',  color: '#7c3aed', group: 'Process' },
  { type: 'tableOutput',    label: 'TableOutputNode',    sub: 'Paginated results table',    color: '#0d9488', group: 'Output' },
  { type: 'export',         label: 'ExportNode',         sub: 'CSV / JSON / GeoJSON',       color: '#b45309', group: 'Output' },
  { type: 'mapOutput',      label: 'MapOutputNode',      sub: 'Geo map (lat/lon records)',  color: '#14532d', group: 'Output' },
  { type: 'timelineOutput', label: 'TimelineOutputNode', sub: 'Year-resolution timeline',   color: '#1e293b', group: 'Output' },
  { type: 'jsonOutput',  label: 'JSONOutputNode',   sub: 'Formatted JSON viewer',     color: '#6d28d9', group: 'Output' },
]

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)

  const handleRunAll = useCallback(async () => {
    if (!rfInstance) return
    setRunningAll(true)
    await runWorkflow(rfInstance.getNodes, rfInstance.getEdges(), rfInstance.updateNodeData)
    setRunningAll(false)
  }, [rfInstance])

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => addEdge(connection, eds)),
    [setEdges],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      if (!reactFlowWrapper.current || !rfInstance) return

      const nodeType = event.dataTransfer.getData('application/reactflow')
      const factory = NODE_DEFAULTS[nodeType]
      if (!factory) return

      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const position = rfInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
      setNodes(nds => [...nds, factory(position)])
    },
    [rfInstance, setNodes],
  )

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'tableOutput' || node.type === 'jsonOutput') {
      setExpandedNodeId(prev => (prev === node.id ? null : node.id))
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1e3a5f' }}>iDAH Federation PoC</span>
        <span style={{ fontSize: 11, color: '#6b7280' }}>Increment 4 — Multi-source workflow</span>
        <div style={{ flex: 1 }} />
        <button
          style={{ ...runAllBtnStyle, opacity: runningAll ? 0.6 : 1 }}
          onClick={handleRunAll}
          disabled={runningAll}
        >
          {runningAll ? '⏳ Running…' : '▶▶ Run All'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={sidebarStyle}>
          {(['Input', 'Source', 'Process', 'Output'] as const).map(group => {
            const items = SIDEBAR_ITEMS.filter(i => i.group === group)
            return (
              <div key={group}>
                <div style={sidebarHeading}>{group}</div>
                {items.map(item => (
                  <div
                    key={item.type}
                    style={sidebarItemStyle}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('application/reactflow', item.type)}
                  >
                    <div style={{ ...sidebarDot, background: item.color }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{item.label}</div>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{item.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: '#d1d5db', padding: '4px', lineHeight: 1.4 }}>
            Double-click a Table or JSON node to expand it
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={reactFlowWrapper} style={{ flex: 1 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setRfInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeDoubleClick={onNodeDoubleClick}
              fitView
            >
              <Background />
              <Controls />
              <MiniMap />
              {/* Expanded output panel — lives inside RF so it can use RF hooks */}
              {expandedNodeId && (
                <ExpandedOutputPanel
                  nodeId={expandedNodeId}
                  onClose={() => setExpandedNodeId(null)}
                />
              )}
            </ReactFlow>
          </div>

          <DebugPanel nodes={nodes} />
        </div>
      </div>
    </div>
  )
}

// ─── Debug panel ──────────────────────────────────────────────────────────────

function DebugPanel({ nodes }: { nodes: AppNode[] }) {
  const [open, setOpen] = useState(false)

  const slim = nodes.map(n => {
    const d = n.data as Record<string, unknown>
    const isSearchNode = n.type === 'gbifSearch' || n.type === 'lldsSearch' || n.type === 'adsSearch' || n.type === 'mdsSearch'
    if (isSearchNode && d.results) {
      const recs = d.results as UnifiedRecord[]
      return {
        id: n.id, type: n.type,
        data: { ...d, results: `[${recs.length} UnifiedRecord(s) — first._source: ${recs[0]?._source}]` },
      }
    }
    return { id: n.id, type: n.type, data: n.data }
  })

  return (
    <div style={debugOuter}>
      <button style={debugToggle} onClick={() => setOpen(o => !o)}>
        {open ? '▼' : '▲'} Debug — node data ({nodes.length} nodes)
      </button>
      {open && (
        <pre style={debugPre}>{JSON.stringify(slim, null, 2)}</pre>
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const topBarStyle: React.CSSProperties = {
  height: 40, background: '#fff', borderBottom: '1px solid #e5e7eb',
  display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', flexShrink: 0,
}

const runAllBtnStyle: React.CSSProperties = {
  background: '#0f4c81', color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const sidebarStyle: React.CSSProperties = {
  width: 184, background: '#fff', borderRight: '1px solid #e5e7eb',
  display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 6, flexShrink: 0,
}

const sidebarHeading: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 4px', marginBottom: 2,
}

const sidebarItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
  borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'grab', userSelect: 'none',
}

const sidebarDot: React.CSSProperties = {
  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
}

const debugOuter: React.CSSProperties = {
  background: '#1e1e1e', color: '#d4d4d4', borderTop: '1px solid #333',
  flexShrink: 0, maxHeight: 200, display: 'flex', flexDirection: 'column',
}

const debugToggle: React.CSSProperties = {
  background: '#2d2d2d', border: 'none', color: '#9ca3af', fontSize: 11,
  padding: '4px 10px', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
}

const debugPre: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', overflowY: 'auto', flex: 1, margin: 0,
}
