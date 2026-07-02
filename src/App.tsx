import { useCallback, useEffect, useRef, useState } from 'react'

import { STORAGE_KEYS } from './config/storageKeys'
import { NODE_DEFAULTS } from './config/nodeDefaults'
import { SIDEBAR_ITEMS } from './config/sidebarItems'
import type { AppNode } from './types/AppNode'
import { attributionStyle, debugOuter, debugToggle, debugPre } from './styles/appStyles'
import { setNodeResults } from './store/resultsStore'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { ExpandedOutputPanel } from './nodes/ExpandedOutputPanel'
import { ChatSidebar } from './components/ChatSidebar'
import { ConnectionSuggestions, HandlePicker, NODE_PARAM_HANDLES } from './components/ConnectionSuggestions'
import { Sidebar } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { useWorkflowIO } from './hooks/useWorkflowIO'
import { useGrouping } from './hooks/useGrouping'
import { useCanvasConnections } from './hooks/useCanvasConnections'
import { runWorkflow } from './utils/runWorkflow'
import type { UnifiedRecord } from './types/UnifiedRecord'

const nodeColourMap = Object.fromEntries(SIDEBAR_ITEMS.map(i => [i.type, i.color]))

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [simpleMode, setSimpleMode] = useState(
    () => (localStorage.getItem(STORAGE_KEYS.SIMPLE_MODE) ?? 'true') === 'true',
  )
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIMPLE_MODE, String(simpleMode))
  }, [simpleMode])

  const [snapEnabled, setSnapEnabled] = useState(
    () => localStorage.getItem(STORAGE_KEYS.SNAP_GRID) === 'true',
  )
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SNAP_GRID, String(snapEnabled))
  }, [snapEnabled])

  // ── Extracted feature hooks ─────────────────────────────────────────────────
  const { handleSave, applyWorkflow, handleLoadFile, loadError, setLoadError } =
    useWorkflowIO(nodes, edges, setNodes, setEdges)

  const { handleGroupSelected, handleUngroup } = useGrouping(rfInstance, nodes, setNodes)

  const {
    connMenu, setConnMenu,
    handlePicker, setHandlePicker,
    onConnect, onDragOver, onDrop, onConnectEnd,
    handleSuggestionSelect, handlePickerSelect,
  } = useCanvasConnections(rfInstance, reactFlowWrapper, setNodes, setEdges)

  const handleRunAll = useCallback(async () => {
    if (!rfInstance) return
    setRunningAll(true)
    await runWorkflow(rfInstance.getNodes, rfInstance.getEdges(), rfInstance.updateNodeData)
    setRunningAll(false)
  }, [rfInstance])

  const instantiateCachedSearch = useCallback(async (service: string, slug: string) => {
    const factory = NODE_DEFAULTS[service]
    if (!factory) return
    // Place near viewport centre, slightly randomised so repeated picks don't overlap
    const screen = { x: window.innerWidth / 2 + Math.random() * 80, y: 180 + Math.random() * 120 }
    const pos = rfInstance ? rfInstance.screenToFlowPosition(screen) : { x: 0, y: 0 }
    const node = factory(pos) as AppNode
    const term = slug.replace(/-/g, ' ')  // "roman-coin" → "roman coin"
    const queryField = service === 'gbifSearch' ? 'inlineQ' : 'inlineQuery'
    node.data = { ...node.data, [queryField]: term, useFixture: true }
    try {
      const res = await fetch(`/fixtures/${service}-${slug}.json`)
      if (res.ok) {
        const records = await res.json()
        const version = setNodeResults(node.id, records)
        node.data = { ...node.data, status: 'cached',
          statusMessage: `📦 ${records.length} (fixture)`, count: records.length, resultsVersion: version }
      } else {
        node.data = { ...node.data, status: 'error', statusMessage: `Fixture not found (HTTP ${res.status})` }
      }
    } catch (e) {
      node.data = { ...node.data, status: 'error', statusMessage: String(e) }
    }
    setNodes(nds => [...nds, node])
  }, [rfInstance, setNodes])

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'tableOutput' || node.type === 'jsonOutput' || node.type === 'comparisonReport') {
      setExpandedNodeId(prev => (prev === node.id ? null : node.id))
    }
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar
        nodes={nodes}
        edges={edges}
        setNodes={setNodes}
        loadError={loadError}
        setLoadError={setLoadError}
        applyWorkflow={applyWorkflow}
        onSave={handleSave}
        onLoadFile={handleLoadFile}
        onGroupSelected={handleGroupSelected}
        onUngroup={handleUngroup}
        onPickCachedSearch={instantiateCachedSearch}
        simpleMode={simpleMode}
        onToggleSimpleMode={() => setSimpleMode(v => !v)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled(v => !v)}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen(v => !v)}
        runningAll={runningAll}
        onRunAll={handleRunAll}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar simpleMode={simpleMode} />

        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={reactFlowWrapper} style={{ flex: 1 }}>
            {/* Prominent yellow selection ring */}
            <style>{`
              .react-flow__node.selectable.selected {
                box-shadow: 0 0 0 3px #f59e0b !important;
                outline: none !important;
              }
              .react-flow__node-input.selectable.selected,
              .react-flow__node-default.selectable.selected,
              .react-flow__node-output.selectable.selected,
              .react-flow__node-group.selectable.selected {
                box-shadow: 0 0 0 3px #f59e0b !important;
                outline: none !important;
              }
            `}</style>
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
              onConnectEnd={onConnectEnd}
              selectionOnDrag
              multiSelectionKeyCode="Shift"
              minZoom={0.1}
              fitView
              snapToGrid={snapEnabled}
              snapGrid={[20, 20]}
            >
              <Background />
              <Controls />
              <MiniMap nodeColor={node => nodeColourMap[node.type ?? ''] ?? '#888'} />
              <Panel position="bottom-left" style={attributionStyle}>
                Conceptualised at King&#39;s Digital Lab
              </Panel>
              {/* Expanded output panel — lives inside RF so it can use RF hooks */}
              {expandedNodeId && (
                <ExpandedOutputPanel
                  nodeId={expandedNodeId}
                  onClose={() => setExpandedNodeId(null)}
                />
              )}
            </ReactFlow>
          </div>

          {import.meta.env.DEV && <DebugPanel nodes={nodes} />}
        </div>

        {/* Right chat sidebar — outside ReactFlow so it doesn't scale with canvas zoom */}
        <ChatSidebar isOpen={chatOpen} onToggle={() => setChatOpen(v => !v)} />
      </div>

      {/* Connection suggestion popup — fixed-position so it's unaffected by canvas zoom */}
      {connMenu && (
        <ConnectionSuggestions
          x={connMenu.x}
          y={connMenu.y}
          sourceNodeType={connMenu.sourceNodeType}
          onSelect={handleSuggestionSelect}
          onClose={() => setConnMenu(null)}
        />
      )}

      {/* Secondary handle picker — shown when a param connects to a multi-handle node */}
      {handlePicker && (
        <HandlePicker
          x={handlePicker.x}
          y={handlePicker.y}
          handles={NODE_PARAM_HANDLES[handlePicker.pendingNodeType] ?? []}
          onSelect={handlePickerSelect}
          onClose={() => setHandlePicker(null)}
        />
      )}
    </div>
  )
}

// ─── Debug panel ──────────────────────────────────────────────────────────────

function DebugPanel({ nodes }: { nodes: AppNode[] }) {
  const [open, setOpen] = useState(false)

  const slim = nodes.map(n => {
    const d = n.data as Record<string, unknown>
    const isSearchNode = n.type === 'gbifSearch' || n.type === 'lldsSearch' || n.type === 'adsSearchAdvanced' || n.type === 'mdsSearch' || n.type === 'adsLibrarySearch' || n.type === 'ariadneSearch' || n.type === 'hsdsSearch'
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
