import { useCallback, useEffect, useRef, useState } from 'react'
import { newId, bumpCounterPast } from './utils/nodeIdCounter'

import { STORAGE_KEYS } from './config/storageKeys'
import { NODE_DEFAULTS, KCL_API_KEY_NODES, findSharedApiKey } from './config/nodeDefaults'
import { SIDEBAR_ITEMS, SIDEBAR_GROUPS, DEFAULT_COLLAPSED_GROUPS, ADVANCED_TYPES } from './config/sidebarItems'
import type { AppNode } from './types/AppNode'
import {
  attributionStyle, topBarStyle, templateBtnStyle, runAllBtnStyle,
  sidebarStyle, sidebarHeading, sidebarItemStyle, sidebarDot,
  debugOuter, debugToggle, debugPre,
} from './styles/appStyles'
import { buildWorkflowPayload, downloadWorkflow, parseWorkflowFile, hydrateNodes, type WorkflowFile } from './utils/workflowIO'
import { exportNotes, importNotes, clearAllNotes } from './store/notesStore'
import { setNodeResults } from './store/resultsStore'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { ExpandedOutputPanel } from './nodes/ExpandedOutputPanel'
import { ChatSidebar } from './components/ChatSidebar'
import { ConnectionSuggestions, HandlePicker, NODE_PARAM_HANDLES, type Suggestion } from './components/ConnectionSuggestions'
import { FixturePreflightPanel } from './components/FixturePreflightPanel'
import { FixtureReferenceCard } from './components/FixtureReferenceCard'
import { UsefulLinksModal } from './components/UsefulLinksModal'
import { ExampleMenu } from './components/ExampleMenu'

/**
 * Handle ids that must only ever carry ONE inbound connection. These are the
 * scalar param-style inputs (query strings, limits, API keys) where two
 * sources would race/overwrite each other. Plural inputs like `data` are
 * intentionally excluded — they are designed to merge multiple upstreams.
 *
 * The set is derived from NODE_PARAM_HANDLES (every handle listed there is a
 * single-value param input) plus the always-singular `apiKey` which can
 * appear on additional node types in future.
 */
const SINGLETON_TARGET_HANDLES = new Set<string>([
  'apiKey',
  ...Object.values(NODE_PARAM_HANDLES).flatMap(hs => hs.map(h => h.id)),
])
import { runWorkflow } from './utils/runWorkflow'
import { invokeToggle } from './utils/groupToggleRegistry'
import type { UnifiedRecord } from './types/UnifiedRecord'

const nodeColourMap = Object.fromEntries(SIDEBAR_ITEMS.map(i => [i.type, i.color]))

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Identity for the notes authored in this workflow; saved into the file so a
  // reloaded/loaded workflow restores its notes, while a blank canvas is fresh.
  const workflowIdRef = useRef<string>(crypto.randomUUID())
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED_GROUPS))
  const [nodeQuery, setNodeQuery] = useState('')
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

  // ── Author mode: click the version text 5× to unlock "Save as Example" ──
  const [authorMode, setAuthorMode] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTHOR_MODE) === 'true',
  )
  const versionClicksRef = useRef(0)
  const versionClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleVersionClick = () => {
    versionClicksRef.current += 1
    if (versionClickTimerRef.current) clearTimeout(versionClickTimerRef.current)
    versionClickTimerRef.current = setTimeout(() => { versionClicksRef.current = 0 }, 2000)
    if (versionClicksRef.current >= 5) {
      versionClicksRef.current = 0
      setAuthorMode(m => {
        const next = !m
        localStorage.setItem(STORAGE_KEYS.AUTHOR_MODE, String(next))
        return next
      })
    }
  }

  // ── Save-as-example dialog ──
  const [exampleDialog, setExampleDialog] = useState<{ title: string; description: string } | null>(null)

  async function handleSaveExample() {
    if (!exampleDialog) return
    const title = exampleDialog.title.trim()
    if (!title) return
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const workflow = buildWorkflowPayload(nodes, edges)
    try {
      const r = await fetch('/dev/write-example', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title, description: exampleDialog.description.trim(), workflow }),
      })
      if (!r.ok) throw new Error(await r.text())
      setExampleDialog(null)
    } catch (e) {
      alert(`Failed to save example: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const [connMenu, setConnMenu] = useState<{
    x: number; y: number
    sourceNodeId: string; sourceNodeType: string; sourceHandleId: string | null
  } | null>(null)

  // Second-step handle picker (for param → multi-handle nodes)
  const [handlePicker, setHandlePicker] = useState<{
    x: number; y: number
    pendingNodeType: string; pendingColor: string
    sourceNodeId: string; sourceHandleId: string | null
  } | null>(null)

  // Auto-resize groups to fit children. Bidirectional (grows AND shrinks) so
  // that no stale dimensions linger across collapse/expand cycles. The previous
  // grow-only behaviour meant a group resized larger by NodeResizer would stay
  // large after expand, and the next collapse would briefly draw the old big
  // outline before the pill size took effect.
  // A 4px tolerance prevents setNodes/measured-resync feedback loops.
  useEffect(() => {
    const groups = nodes.filter(n => n.type === 'group')
    if (groups.length === 0) return

    const TOLERANCE = 4
    const updated = nodes.map(node => {
      if (node.type !== 'group') return node
      if ((node.data as any).collapsed) return node

      const children = nodes.filter(n => n.parentId === node.id)
      if (children.length === 0) return node

      let maxX = 0, maxY = 0
      for (const child of children) {
        const cw = Number(child.measured?.width ?? (child as any).style?.width ?? 220)
        const ch = Number(child.measured?.height ?? (child as any).style?.height ?? 100)
        maxX = Math.max(maxX, child.position.x + cw)
        maxY = Math.max(maxY, child.position.y + ch)
      }

      const padding = 30
      const targetW = Math.max(250, maxX + padding)
      const targetH = Math.max(120, maxY + padding)
      const currentW = Number((node as any).style?.width ?? 0)
      const currentH = Number((node as any).style?.height ?? 0)

      if (Math.abs(targetW - currentW) <= TOLERANCE && Math.abs(targetH - currentH) <= TOLERANCE) {
        return node
      }
      return {
        ...node,
        width: targetW,
        height: targetH,
        style: {
          ...((node as any).style ?? {}),
          width: targetW,
          height: targetH,
        },
      } as AppNode
    })

    const changed = updated.some((n, i) => n !== nodes[i])
    if (changed) setNodes(updated)
  }, [nodes, setNodes])

  const handleRunAll = useCallback(async () => {
    if (!rfInstance) return
    setRunningAll(true)
    await runWorkflow(rfInstance.getNodes, rfInstance.getEdges(), rfInstance.updateNodeData)
    setRunningAll(false)
  }, [rfInstance])

  const handleGroupSelected = useCallback(() => {
    if (!rfInstance) return
    const currentNodes = rfInstance.getNodes()
    const selected = currentNodes.filter(n => n.selected && n.type !== 'group')
    if (selected.length < 2) return

    // Calculate bounding box with padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of selected) {
      const w = (n as Node & { style?: { width?: number; height?: number } }).style?.width ?? 200
      const h = (n as Node & { style?: { width?: number; height?: number } }).style?.height ?? 100
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    const padding = 20
    const headerH = 35
    const width  = maxX - minX + padding * 2
    const height = maxY - minY + padding * 2 + headerH
    const groupPos = { x: minX - padding, y: minY - padding - headerH }

    // Count existing groups for naming
    const existingNames = new Set(
      currentNodes.filter(n => n.type === 'group').map(n => (n.data as { name?: string }).name ?? '')
    )
    let groupNumber = 1
    while (existingNames.has(`Group ${groupNumber}`)) {
      groupNumber++
    }
    const groupName = `Group ${groupNumber}`

    const groupNode = {
      id: newId('group'),
      type: 'group',
      position: groupPos,
      style: { width, height },
      data: { name: groupName },
      selected: true,
    } as AppNode

    const updatedNodes = currentNodes.map(n => {
      if (!n.selected || n.type === 'group') return n
      return {
        ...n,
        parentId: groupNode.id,
        position: {
          x: n.position.x - groupPos.x,
          y: n.position.y - groupPos.y,
        },
        extent: 'parent' as const,
        expandParent: true,
        selected: false,
      }
    })

    // Parent must precede children in the array so React Flow resolves
    // the parentId reference before rendering children.
    setNodes([groupNode, ...updatedNodes])
  }, [rfInstance, setNodes])

  const handleUngroup = useCallback(() => {
    if (!rfInstance) return
    const currentNodes = rfInstance.getNodes()
    const selectedGroup = currentNodes.find(n => n.selected && n.type === 'group')
    if (!selectedGroup) return

    // Refuse to ungroup while collapsed — edges still point at proxy handles and
    // would become orphaned when the group node is deleted.
    if ((selectedGroup.data as any).collapsed) {
      invokeToggle(selectedGroup.id)
      return
    }

    const groupPos = selectedGroup.position
    const updatedNodes = currentNodes.map(n => {
      if (n.parentId !== selectedGroup.id) return n
      return {
        ...n,
        parentId: undefined,
        extent: undefined,
        expandParent: undefined,
        position: {
          x: n.position.x + groupPos.x,
          y: n.position.y + groupPos.y,
        },
      }
    })

    setNodes(updatedNodes.filter(n => n.id !== selectedGroup.id))
  }, [rfInstance, setNodes])

  const handleSave = useCallback(() => {
    const extras = { workflowId: workflowIdRef.current, notes: exportNotes() }
    const payload = buildWorkflowPayload(nodes, edges, extras)
    downloadWorkflow(nodes, edges, extras)
    fetch('/api/save-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }, [nodes, edges])

  // Shared workflow application logic — used by both file Load and Example load.
  const applyWorkflow = useCallback((wf: WorkflowFile) => {
    const hydrated = hydrateNodes(wf)
    bumpCounterPast(hydrated.map(n => n.id))
    // Adopt the loaded workflow's identity and restore its notes (replacing any
    // notes from the previously-open workflow in this session).
    workflowIdRef.current = wf.workflowId ?? crypto.randomUUID()
    importNotes(wf.notes)
    setNodes(hydrated)
    // Strip edges that reference proxy handles of expanded groups — these are
    // stale refs left by incomplete collapse/expand cycles in a prior session.
    const expandedGroupIds = new Set(
      hydrated
        .filter(n => n.type === 'group' && !(n.data as any).collapsed)
        .map(n => n.id),
    )
    setEdges(
      wf.edges.filter(
        ed =>
          !(ed.sourceHandle?.startsWith('proxy-out-') && expandedGroupIds.has(ed.source)) &&
          !(ed.targetHandle?.startsWith('proxy-in-') && expandedGroupIds.has(ed.target)),
      ),
    )
    setLoadError(null)
  }, [setNodes, setEdges])

  const handleLoadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-loaded if needed
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wf = parseWorkflowFile(ev.target?.result as string)
        applyWorkflow(wf)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load workflow.')
      }
    }
    reader.readAsText(file)
  }, [applyWorkflow])

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => {
      // Singleton enforcement: if the target handle accepts only one inbound
      // edge, drop any existing edge to (target, targetHandle) before adding.
      const th = connection.targetHandle
      const needsReplace =
        th != null &&
        SINGLETON_TARGET_HANDLES.has(th) &&
        eds.some(e => e.target === connection.target && e.targetHandle === th)
      const base = needsReplace
        ? eds.filter(e => !(e.target === connection.target && e.targetHandle === th))
        : eds
      return addEdge(connection, base)
    }),
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
      setNodes(nds => {
        const newNode = factory(position) as AppNode
        if (KCL_API_KEY_NODES.has(nodeType) && !(newNode.data as { apiKey?: string }).apiKey) {
          const key = findSharedApiKey(nds)
          if (key) (newNode.data as Record<string, unknown>).apiKey = key
        }
        return [...nds, newNode]
      })
    },
    [rfInstance, setNodes],
  )

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

  // ── Connection suggestions ─────────────────────────────────────────────────

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (!state.fromNode || state.toNode) return   // normal connection or no drag — nothing to do
    const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event

    if (state.fromHandle?.type === 'source') {
      // Forward drag: output handle → empty canvas → show node suggestions
      setConnMenu({
        x: clientX, y: clientY,
        sourceNodeId:   state.fromNode.id,
        sourceNodeType: state.fromNode.type ?? '',
        sourceHandleId: state.fromHandle?.id ?? null,
      })
      return
    }

    if (state.fromHandle?.type === 'target') {
      // Reverse drag: input handle → empty canvas → auto-create a Param node
      const handleId = state.fromHandle.id
      if (!handleId || handleId === 'data' || handleId === 'results') return
      if (!rfInstance) return
      const position = rfInstance.screenToFlowPosition({ x: clientX - 20, y: clientY - 20 })
      const newParam  = NODE_DEFAULTS['param'](position)
      const targetId  = state.fromNode!.id
      setNodes(prev => [...prev, newParam as AppNode])
      setEdges(prev => {
        const base = SINGLETON_TARGET_HANDLES.has(handleId)
          ? prev.filter(e => !(e.target === targetId && e.targetHandle === handleId))
          : prev
        return addEdge({
          id:           `e-${newParam.id}-${targetId}`,
          source:       newParam.id,
          target:       targetId,
          targetHandle: handleId,
        }, base)
      })
    }
  }, [rfInstance, setNodes, setEdges])

  // Create node + edge immediately (used when targetHandle is already known)
  const createNodeWithEdge = useCallback((
    nodeType: string,
    targetHandle: string,
    x: number, y: number,
    sourceNodeId: string,
    sourceHandleId: string | null,
  ) => {
    if (!rfInstance) return
    const factory = NODE_DEFAULTS[nodeType]
    if (!factory) return
    const position = rfInstance.screenToFlowPosition({ x: x + 20, y: y - 20 })
    const newNode  = factory(position) as AppNode
    if (KCL_API_KEY_NODES.has(nodeType) && !(newNode.data as { apiKey?: string }).apiKey) {
      const key = findSharedApiKey(rfInstance.getNodes())
      if (key) (newNode.data as Record<string, unknown>).apiKey = key
    }
    setNodes(prev => [...prev, newNode as AppNode])
    setEdges(prev => addEdge({
      id:           `e-${sourceNodeId}-${newNode.id}`,
      source:       sourceNodeId,
      sourceHandle: sourceHandleId ?? undefined,
      target:       newNode.id,
      targetHandle,
    }, prev))
  }, [rfInstance, setNodes, setEdges])

  const handleSuggestionSelect = useCallback((s: Suggestion) => {
    if (!connMenu) return

    if (s.targetHandle !== null) {
      // Direct connection — handle is unambiguous
      createNodeWithEdge(s.type, s.targetHandle, connMenu.x, connMenu.y, connMenu.sourceNodeId, connMenu.sourceHandleId)
      return
    }

    // Multiple handles available — show the handle picker as a second step
    const handles = NODE_PARAM_HANDLES[s.type]
    if (!handles || handles.length === 0) return
    if (handles.length === 1) {
      createNodeWithEdge(s.type, handles[0].id, connMenu.x, connMenu.y, connMenu.sourceNodeId, connMenu.sourceHandleId)
      return
    }
    setHandlePicker({
      x: connMenu.x, y: connMenu.y,
      pendingNodeType:  s.type,
      pendingColor:     s.color,
      sourceNodeId:     connMenu.sourceNodeId,
      sourceHandleId:   connMenu.sourceHandleId,
    })
  }, [connMenu, createNodeWithEdge])

  const handlePickerSelect = useCallback((handleId: string) => {
    if (!handlePicker) return
    createNodeWithEdge(
      handlePicker.pendingNodeType, handleId,
      handlePicker.x, handlePicker.y,
      handlePicker.sourceNodeId, handlePicker.sourceHandleId,
    )
    setHandlePicker(null)
  }, [handlePicker, createNodeWithEdge])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
          <span style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            <b>N</b>ational <b>F</b>ederated <b>C</b>ompute <b>S</b>ervices
            {' – '}
            <em style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 400 }}>Arts &amp; Humanities</em>
          </span>
          <span
            style={{ fontSize: 9, color: authorMode ? '#f59e0b' : '#9ca3af', letterSpacing: '0.02em', cursor: 'default', userSelect: 'none' }}
            onClick={handleVersionClick}
            title={authorMode ? 'Author mode ON — click 5× to toggle' : undefined}
          >
            Proof of Concept. V2.0{authorMode ? ' ★' : ''}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <ExampleMenu onLoad={wf => { try { applyWorkflow(wf) } catch (e) { setLoadError(e instanceof Error ? e.message : 'Failed to load example.') } }} />
        <button
          style={templateBtnStyle}
          onClick={handleSave}
          title="Save workflow configuration to a JSON file"
          disabled={nodes.length === 0}
        >
          💾 Save
        </button>
        {authorMode && (
          <button
            style={{ ...templateBtnStyle, background: '#78350f', color: '#fef3c7', borderColor: '#92400e' }}
            onClick={() => setExampleDialog({ title: '', description: '' })}
            title="Save current workflow as a loadable example (author mode)"
            disabled={nodes.length === 0}
          >
            ★ Save as Example
          </button>
        )}
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
        <button
          style={templateBtnStyle}
          onClick={() => {
            if (window.confirm('Clear all notes (prose and structured) in this workflow? This cannot be undone.')) {
              clearAllNotes()
              setNodes(nds => nds.map(n =>
                n.type === 'quickNote' && (n.data as { structuredByRecord?: unknown }).structuredByRecord
                  ? { ...n, data: { ...n.data, structuredByRecord: {} } }
                  : n))
            }
          }}
          title="Remove every per-record note (prose and structured) in the current workflow"
        >
          🗑 Clear notes
        </button>
        {/* Save-as-example dialog */}
        {exampleDialog && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              background: '#1e2130', border: '1px solid #2d3348', borderRadius: 10,
              padding: 24, minWidth: 360, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Save as Example Workflow</div>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                Title *
                <input
                  autoFocus
                  value={exampleDialog.title}
                  onChange={e => setExampleDialog(d => d ? { ...d, title: e.target.value } : null)}
                  placeholder="e.g. GBIF species search"
                  style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid #4b5563', background: '#111827', color: '#e2e8f0', outline: 'none' }}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveExample(); if (e.key === 'Escape') setExampleDialog(null) }}
                />
              </label>
              <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                Description
                <input
                  value={exampleDialog.description}
                  onChange={e => setExampleDialog(d => d ? { ...d, description: e.target.value } : null)}
                  placeholder="One-line summary of what this workflow demonstrates"
                  style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid #4b5563', background: '#111827', color: '#e2e8f0', outline: 'none' }}
                  onKeyDown={e => { if (e.key === 'Escape') setExampleDialog(null) }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setExampleDialog(null)}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: '1px solid #4b5563', background: 'none', color: '#9ca3af', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveExample}
                  disabled={!exampleDialog.title.trim()}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: 'none', background: '#92400e', color: '#fef3c7', cursor: 'pointer', fontWeight: 600 }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
        {(() => {
          const selected = nodes.filter(n => n.selected && n.type !== 'group')
          const groupSelected = nodes.find(n => n.selected && n.type === 'group')
          return (
            <>
              {selected.length >= 2 && (
                <button
                  style={templateBtnStyle}
                  onClick={handleGroupSelected}
                  title={`Group ${selected.length} selected nodes`}
                >
                  📦 Group ({selected.length})
                </button>
              )}
              {groupSelected && (
                <button
                  style={templateBtnStyle}
                  onClick={handleUngroup}
                  title={`Ungroup "${ (groupSelected.data as { name?: string }).name ?? 'Group' }"`}
                >
                  📤 Ungroup
                </button>
              )}
              {selected.length > 0 && (
                <span style={{ fontSize: 11, color: '#6b7280', marginRight: 4 }}>
                  {selected.length} selected
                </span>
              )}
            </>
          )
        })()}
        {loadError && (
          <span style={{ fontSize: 11, color: '#dc2626', maxWidth: 200 }} title={loadError}>
            ⚠ {loadError}
          </span>
        )}
        <FixtureReferenceCard onPick={instantiateCachedSearch} />
        <UsefulLinksModal />
        {import.meta.env.DEV && <FixturePreflightPanel />}
        <button
          style={{ ...templateBtnStyle, background: !simpleMode ? '#312e81' : undefined, color: !simpleMode ? '#fff' : undefined, borderColor: !simpleMode ? '#312e81' : undefined }}
          onClick={() => setSimpleMode(v => !v)}
          title={simpleMode
            ? 'Simple mode — specialised/alpha nodes hidden. Click for Advanced.'
            : 'Advanced mode — all nodes shown. Click for Simple.'}
        >
          {simpleMode ? '◐ Simple' : '◑ Advanced'}
        </button>
        <button
          style={{ ...templateBtnStyle, background: snapEnabled ? '#0f4c81' : undefined, color: snapEnabled ? '#fff' : undefined, borderColor: snapEnabled ? '#0f4c81' : undefined }}
          onClick={() => setSnapEnabled(v => !v)}
          title={snapEnabled ? 'Grid snap ON — click to disable' : 'Grid snap OFF — click to enable (20px grid)'}
        >
          {snapEnabled ? '⊞ Snap' : '⊟ Snap'}
        </button>
        <button
          style={{ ...templateBtnStyle, background: chatOpen ? '#881337' : undefined, color: chatOpen ? '#fff' : undefined, borderColor: chatOpen ? '#881337' : undefined }}
          onClick={() => setChatOpen(v => !v)}
          title="Toggle KCL Assistant chat"
        >
          💬 Assistant
        </button>
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
          {/* Node search — sticky, pinned while the list scrolls */}
          <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', paddingBottom: 6 }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={nodeQuery}
                onChange={e => setNodeQuery(e.target.value)}
                placeholder="Search nodes…"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '6px 22px 6px 8px', fontSize: 12,
                  border: '1px solid #e5e7eb', borderRadius: 6, outline: 'none',
                }}
              />
              {nodeQuery && (
                <button
                  type="button"
                  onClick={() => setNodeQuery('')}
                  title="Clear search"
                  style={{
                    position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer',
                    fontSize: 12, color: '#9ca3af', lineHeight: 1, padding: 2,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          {SIDEBAR_GROUPS.map(group => {
            const q = nodeQuery.trim().toLowerCase()
            const searching = q.length > 0
            const isExperimental = group === 'Experimental'
            // Experimental group is entirely hidden in Simple mode
            if (isExperimental && simpleMode) return null
            const items = SIDEBAR_ITEMS.filter(
              i => i.group === group && !i.hidden && (!simpleMode || !ADVANCED_TYPES.has(i.type)) &&
                (!searching
                  || i.label.toLowerCase().includes(q)
                  || i.sub.toLowerCase().includes(q)
                  || i.type.toLowerCase().includes(q)),
            )
            // While searching, hide groups with no matches for a clean list
            if (searching && items.length === 0) return null
            // While searching, force-expand so matches in collapsed groups show
            const isCollapsed = searching ? false : collapsedGroups.has(group)
            const toggleGroup = () => setCollapsedGroups(prev => {
              const next = new Set(prev)
              next.has(group) ? next.delete(group) : next.add(group)
              return next
            })
            return (
              <div key={group} style={isExperimental ? { borderLeft: '3px solid #f59e0b', paddingLeft: 4, marginTop: 4 } : undefined}>
                <div
                  style={{ ...sidebarHeading, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onClick={toggleGroup}
                >
                  <span>{isExperimental ? '⚗ Experimental' : group}</span>
                  <span style={{ fontSize: 9, color: '#d1d5db' }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>
                {isExperimental && !isCollapsed && (
                  <div style={{ fontSize: 9, color: '#d97706', fontStyle: 'italic', padding: '0 4px 4px', lineHeight: 1.4 }}>
                    These nodes may change behaviour between releases.
                  </div>
                )}
                {!isCollapsed && items.map(item => (
                  <div
                    key={item.type}
                    style={{ ...sidebarItemStyle, opacity: item.deprecated ? 0.55 : 1 }}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('application/reactflow', item.type)}
                    title={item.deprecated ? 'Deprecated — service currently unavailable' : undefined}
                  >
                    <div style={{ ...sidebarDot, background: item.color }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, textDecoration: item.deprecated ? 'line-through' : 'none', color: item.deprecated ? '#9ca3af' : undefined }}>
                        {item.label}
                        {item.deprecated && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#ef4444', textDecoration: 'none', verticalAlign: 'middle' }}>DEPRECATED</span>}
                      </div>
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

