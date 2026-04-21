import { useCallback, useRef, useState } from 'react'
import { newId, bumpCounterPast } from './utils/nodeIdCounter'
import { downloadWorkflow, parseWorkflowFile, hydrateNodes } from './utils/workflowIO'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type XYPosition,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { ExpandedOutputPanel } from './nodes/ExpandedOutputPanel'
import { runWorkflow } from './utils/runWorkflow'
import type { UnifiedRecord } from './types/UnifiedRecord'
import type { LocalFolderSourceNodeData } from './nodes/LocalFolderSourceNode'
import type { LocalFileSourceNodeData }   from './nodes/LocalFileSourceNode'
import type { OllamaNodeData }            from './nodes/OllamaNode'
import type { OllamaFieldNodeData }       from './nodes/OllamaFieldNode'
import type { URLFetchNodeData }          from './nodes/URLFetchNode'
import type { HTMLSectionNodeData }       from './nodes/HTMLSectionNode'
import type { LLDSSearchNodeData }        from './nodes/LLDSSearchNode'
import type { ADSSearchNodeData }             from './nodes/ADSSearchNode'
import type { ADSSearchAdvancedNodeData }     from './nodes/ADSSearchAdvancedNode'
import type { ADSLibraryNodeData }            from './nodes/ADSLibraryNode'
import type { MDSSearchNodeData }         from './nodes/MDSSearchNode'
import type { ReconciliationNodeData }    from './nodes/ReconciliationNode'
import type { FilterTransformNodeData }   from './nodes/FilterTransformNode'
import type { SpatialFilterNodeData }     from './nodes/SpatialFilterNode'
import type { ExportNodeData }            from './nodes/ExportNode'
import type { QuickViewNodeData }         from './nodes/QuickViewNode'
import type { CommentNodeData }           from './nodes/CommentNode'

// ─── node data types (kept slim here; full types live in each node file) ─────

interface ParamNodeData  { label: string; paramType: string; value: string; [k: string]: unknown }
interface SearchNodeData { status: string; statusMessage: string; results?: UnifiedRecord[]; count?: number; [k: string]: unknown }
interface OutputNodeData { [k: string]: unknown }

type AppNode =
  | Node<ParamNodeData>
  | Node<SearchNodeData>
  | Node<LocalFolderSourceNodeData>
  | Node<LocalFileSourceNodeData>
  | Node<OllamaNodeData>
  | Node<OllamaFieldNodeData>
  | Node<URLFetchNodeData>
  | Node<HTMLSectionNodeData>
  | Node<LLDSSearchNodeData>
  | Node<ADSSearchNodeData>
  | Node<ADSSearchAdvancedNodeData>
  | Node<ADSLibraryNodeData>
  | Node<MDSSearchNodeData>
  | Node<ReconciliationNodeData>
  | Node<FilterTransformNodeData>
  | Node<SpatialFilterNodeData>
  | Node<ExportNodeData>
  | Node<QuickViewNodeData>
  | Node<CommentNodeData>
  | Node<OutputNodeData>

// ─── node factories ───────────────────────────────────────────────────────────

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
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies ADSSearchNodeData,
  }),
  adsLibrarySearch: pos => ({
    id: newId('adslib'), type: 'adsLibrarySearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    } satisfies ADSLibraryNodeData,
  }),
  adsSearchAdvanced: pos => ({
    id: newId('ads'), type: 'adsSearchAdvanced', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '',
      sort: '_score', order: 'desc',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies ADSSearchAdvancedNodeData,
  }),
  mdsSearch: pos => ({
    id: newId('mds'), type: 'mdsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    } satisfies MDSSearchNodeData,
  }),
  localFileSource: pos => ({
    id: newId('csvfile'), type: 'localFileSource', position: pos,
    data: {
      delimiter:     'auto',
      hasHeader:     true,
      autoCast:      true,
      fileName:      '',
      status:        'idle',
      statusMessage: '',
      count:         0,
      columnNames:   [],
    } satisfies LocalFileSourceNodeData,
  }),
  localFolderSource: pos => ({
    id: newId('folder'), type: 'localFolderSource', position: pos,
    data: {
      fileTypes:     ['pdf', 'xml', 'text', 'image'],
      maxFiles:      50,
      folderName:    '',
      status:        'idle',
      statusMessage: '',
      results:       undefined,
      count:         0,
      gisLayers:     undefined,
      gisCount:      0,
    } satisfies LocalFolderSourceNodeData,
  }),
  ollamaNode: pos => ({
    id: newId('ollama'), type: 'ollamaNode', position: pos,
    data: {
      model:               '',
      visionOverride:      false,
      systemPrompt:        'You are a research assistant helping to analyse humanities research documents and data.',
      userPromptTemplate:  'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}',
      temperature:         0.7,
      maxTokens:           1024,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies OllamaNodeData,
  }),
  ollamaField: pos => ({
    id: newId('ollamaField'), type: 'ollamaField', position: pos,
    data: {
      model:               '',
      selectedField:       '',
      mode:                'per-record',
      systemPrompt:        'You are a research assistant helping to analyse humanities research data.',
      userPromptTemplate:  'Summarise the following in 2–3 sentences:\n\n{{value}}',
      temperature:         0.7,
      maxTokens:           1024,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies OllamaFieldNodeData,
  }),
  urlFetch: pos => ({
    id: newId('urlFetch'), type: 'urlFetch', position: pos,
    data: {
      urlField:      '_sourceUrl',
      stripHtml:     true,
      maxLength:     8000,
      timeoutSecs:   10,
      renderJs:      false,
      waitStrategy:  'networkidle2',
      status:        'idle',
      statusMessage: '',
      results:       undefined,
      inputCount:    0,
      outputCount:   0,
    } satisfies URLFetchNodeData,
  }),
  htmlSection: pos => ({
    id: newId('htmlSection'), type: 'htmlSection', position: pos,
    data: {
      selector:      'main, article',
      separator:     '\n\n',
      maxLength:     8000,
      preserveHtml:  false,
      status:        'idle',
      statusMessage: '',
      inputCount:    0,
      outputCount:   0,
    } satisfies HTMLSectionNodeData,
  }),
  filterTransform: pos => ({
    id: newId('ft'), type: 'filterTransform', position: pos,
    data: {
      mode:             'filter',
      filterCombinator: 'AND',
      filterOps:        [],
      transformOps:     [],
      status:           'idle',
      statusMessage:    '',
      results:          undefined,
      inputCount:       0,
      outputCount:      0,
    } satisfies FilterTransformNodeData,
  }),
  spatialFilter: pos => ({
    id: newId('sf'), type: 'spatialFilter', position: pos,
    data: {
      bbox:           null,
      status:         'idle',
      statusMessage:  '',
      results:        undefined,
      inputCount:     0,
      outputCount:    0,
    } satisfies SpatialFilterNodeData,
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
  quickView: pos => ({
    id: newId('quickView'), type: 'quickView', position: pos,
    data: { selectedField: '' } satisfies QuickViewNodeData,
  }),
  comment: pos => ({
    id: newId('comment'), type: 'comment', position: pos,
    data: { title: '', body: '' } satisfies CommentNodeData,
    style: { width: 220, height: 120 },
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
  ollamaOutput: pos => ({
    id: newId('ollamaOut'), type: 'ollamaOutput', position: pos,
    data: {},
  }),
}

// ─── sidebar definition ───────────────────────────────────────────────────────

const SIDEBAR_ITEMS = [
  { type: 'comment',     label: 'Comment',           sub: 'Annotation label',          color: '#f59e0b', group: 'Canvas' },
  { type: 'param',       label: 'ParamNode',        sub: 'Text / Integer value',      color: '#3b82f6', group: 'Input' },
  { type: 'localFileSource',   label: 'LocalFileSource',   sub: 'Parse a single CSV/TSV file',  color: '#0e7490', group: 'Search' },
  { type: 'localFolderSource', label: 'LocalFolderSource', sub: 'Read files from local folder', color: '#14532d', group: 'Search' },
  { type: 'gbifSearch',  label: 'GBIFSearchNode',   sub: 'GBIF occurrence search',    color: '#0f4c81', group: 'Search' },
  { type: 'lldsSearch',  label: 'LLDSSearchNode',   sub: 'Lit. & Linguistic Data',    color: '#92400e', group: 'Search' },
  { type: 'adsSearch',         label: 'ADSSearchNode',         sub: 'Archaeology Data Service',           color: '#7c2d12', group: 'Search' },
  { type: 'adsSearchAdvanced', label: 'ADSSearchAdvancedNode', sub: 'ADS search with facet filters', color: '#78350f', group: 'Search' },
  { type: 'adsLibrarySearch',  label: 'ADSLibraryNode',        sub: 'ADS Library catalogue',         color: '#1e3a5f', group: 'Search' },
  { type: 'mdsSearch',      label: 'MDSSearchNode',      sub: 'Museum Data Service',        color: '#1e3a8a', group: 'Search' },
  { type: 'ollamaNode',      label: 'OllamaNode',          sub: 'Local LLM — file/content records', color: '#312e81', group: 'Process' },
  { type: 'ollamaField',    label: 'OllamaFieldNode',     sub: 'LLM inference on a chosen field',  color: '#1e1b4b', group: 'Process' },
  { type: 'urlFetch',       label: 'URLFetchNode',        sub: 'Fetch URL content into records',   color: '#0c4a6e', group: 'Process' },
  { type: 'htmlSection',   label: 'HTMLSectionNode',     sub: 'Extract page section by CSS selector', color: '#065f46', group: 'Process' },
  { type: 'filterTransform', label: 'FilterTransformNode', sub: 'Filter + transform records', color: '#4f46e5', group: 'Process' },
  { type: 'spatialFilter',   label: 'Spatial Filter',      sub: 'Draw bounding box to filter by location', color: '#0891b2', group: 'Process' },
  { type: 'reconciliation',  label: 'ReconciliationNode',  sub: 'Wikidata field reconciler',  color: '#7c3aed', group: 'Process' },
  { type: 'quickView',      label: 'QuickViewNode',      sub: 'Inspect one field in full',  color: '#1e293b', group: 'Output' },
  { type: 'tableOutput',    label: 'TableOutputNode',    sub: 'Paginated results table',    color: '#0d9488', group: 'Output' },
  { type: 'export',         label: 'ExportNode',         sub: 'CSV / JSON / GeoJSON',       color: '#b45309', group: 'Output' },
  { type: 'mapOutput',      label: 'MapOutputNode',      sub: 'Geo map (lat/lon records)',  color: '#14532d', group: 'Output' },
  { type: 'timelineOutput', label: 'TimelineOutputNode', sub: 'Year-resolution timeline',   color: '#1e293b', group: 'Output' },
  { type: 'jsonOutput',    label: 'JSONOutputNode',   sub: 'Formatted JSON viewer',       color: '#6d28d9', group: 'Output' },
  { type: 'ollamaOutput', label: 'OllamaOutputNode', sub: 'Display Ollama inference text', color: '#0f172a', group: 'Output' },
]

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['Search', 'Process', 'Output']))

  const handleRunAll = useCallback(async () => {
    if (!rfInstance) return
    setRunningAll(true)
    await runWorkflow(rfInstance.getNodes, rfInstance.getEdges(), rfInstance.updateNodeData)
    setRunningAll(false)
  }, [rfInstance])

  const handleSave = useCallback(() => {
    downloadWorkflow(nodes, edges)
  }, [nodes, edges])

  const handleLoadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-loaded if needed
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wf = parseWorkflowFile(ev.target?.result as string)
        const hydrated = hydrateNodes(wf)
        bumpCounterPast(hydrated.map(n => n.id))
        setNodes(hydrated)
        setEdges(wf.edges)
        setLoadError(null)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load workflow.')
      }
    }
    reader.readAsText(file)
  }, [setNodes, setEdges])

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
        <div style={{ flex: 1 }} />
        <button
          style={templateBtnStyle}
          onClick={handleSave}
          title="Save workflow configuration to a JSON file"
          disabled={nodes.length === 0}
        >
          💾 Save
        </button>
        <button
          style={templateBtnStyle}
          onClick={() => fileInputRef.current?.click()}
          title="Load workflow configuration from a JSON file"
        >
          📂 Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleLoadFile}
        />
        {loadError && (
          <span style={{ fontSize: 11, color: '#dc2626', maxWidth: 200 }} title={loadError}>
            ⚠ {loadError}
          </span>
        )}
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
          {(['Canvas', 'Input', 'Search', 'Process', 'Output'] as const).map(group => {
            const items      = SIDEBAR_ITEMS.filter(i => i.group === group)
            const isCollapsed = collapsedGroups.has(group)
            const toggleGroup = () => setCollapsedGroups(prev => {
              const next = new Set(prev)
              next.has(group) ? next.delete(group) : next.add(group)
              return next
            })
            return (
              <div key={group}>
                <div
                  style={{ ...sidebarHeading, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onClick={toggleGroup}
                >
                  <span>{group}</span>
                  <span style={{ fontSize: 9, color: '#d1d5db' }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>
                {!isCollapsed && items.map(item => (
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
    const isSearchNode = n.type === 'gbifSearch' || n.type === 'lldsSearch' || n.type === 'adsSearch' || n.type === 'mdsSearch' || n.type === 'adsLibrarySearch'
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

const templateBtnStyle: React.CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6,
  padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const runAllBtnStyle: React.CSSProperties = {
  background: '#0f4c81', color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const sidebarStyle: React.CSSProperties = {
  width: 184, background: '#fff', borderRight: '1px solid #e5e7eb',
  display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 6, flexShrink: 0,
  overflowY: 'auto',
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
