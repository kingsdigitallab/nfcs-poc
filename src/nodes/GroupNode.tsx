/**
 * GroupNode — visual container for grouping multiple nodes together.
 * Supports full collapse/expand with proxy handles on the boundary so
 * external edge connections remain visible in collapsed mode.
 *
 * Implementation notes (critical):
 * 1. Proxy handle slots are ALWAYS rendered but hidden with display:none
 *    when expanded. This guarantees React Flow registers them in its
 *    handle registry so edges can be rewired to the slots on collapse.
 * 2. Children are hidden via CSS opacity:0 + pointerEvents:none instead
 *    of n.hidden:true. React Flow still considers them "visible" nodes,
 *    so rewired edges (which now target the group, not the child) render.
 * 3. On collapse we set explicit node.width / node.height so React Flow
 *    resizes the wrapper div immediately without waiting for ResizeObserver.
 * 4. After toggle, updateNodeInternals(id) is called so React Flow re-scans
 *    the handle registry and re-routes edges to the newly active slots.
 */

import { useCallback, useMemo, useEffect } from 'react'
import {
  useReactFlow,
  NodeProps,
  NodeResizer,
  Handle,
  Position,
  useUpdateNodeInternals,
  type Edge,
  type Node,
} from '@xyflow/react'
import { registerToggle } from '../utils/groupToggleRegistry'

/* ─── Data types ────────────────────────────────────────────────────────── */

export interface GroupNodeData {
  name: string
  collapsed?: boolean
  originalWidth?: number
  originalHeight?: number
  childPositions?: Record<string, { x: number; y: number }>
  proxyEdges?: ProxyEdgeInfo[]
  [k: string]: unknown
}

interface ProxyEdgeInfo {
  edgeId: string
  originalSource: string
  originalTarget: string
  originalSourceHandle?: string | null
  originalTargetHandle?: string | null
  side: 'in' | 'out'
  slot: number
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const BORDER_COLOR = '#3b82f6'
const HEADER_BG    = '#3b82f6'

const MAX_SLOTS = 8
const SLOT_STEP = 18  // vertical spacing between proxy dots

/* ─── Helpers ───────────────────────────────────────────────────────────── */

function nodeTypeName(all: Node[], id: string): string {
  const n = all.find(x => x.id === id)
  return (n?.type ?? 'node').replace(/Search$|Node$/, '') || 'node'
}

/* ─── Component ─────────────────────────────────────────────────────────── */

export function GroupNode({ id, data, selected }: NodeProps) {
  const {
    getNodes,
    setNodes,
    getEdges,
    setEdges,
    updateNodeData,
  } = useReactFlow()

  const updateInternals = useUpdateNodeInternals()

  const d = data as GroupNodeData
  const collapsed = !!d.collapsed

  /* Read reactive state --------------------------------------------------- */
  const allNodes = getNodes()
  const allEdges = getEdges()
  const children = allNodes.filter((n: Node) => n.parentId === id)
  const childIds = useMemo(
    () => new Set(children.map((c: Node) => c.id)),
    [children.map(c => c.id).join(',')]
  )

  /*
   * slotData = which slot each edge occupies (side + slot index).
   * Only meaningful when collapsed, but we keep the calculation.
   */
  const slotData = useMemo(() => {
    if (!collapsed || !d.proxyEdges || d.proxyEdges.length === 0) return {}

    const map: Record<string, { side: 'in' | 'out'; slot: number }> = {}
    for (const p of d.proxyEdges) {
      map[p.edgeId] = { side: p.side, slot: p.slot }
    }
    return map
  }, [collapsed, d.proxyEdges])

  /* Build proxy labels (only needed when collapsed) ----------------------- */
  const proxyLabels = useMemo(() => {
    if (!collapsed) return {}
    const labels: Record<string, string> = {}
    for (const [edgeId, info] of Object.entries(slotData)) {
      const pr = d.proxyEdges?.find(p => p.edgeId === edgeId)
      if (!pr) continue

      if (info.side === 'in') {
        // Incoming: edge from outside -> child(target)
        // Label the hidden CHILD node's type + target handle
        labels[edgeId] = `${nodeTypeName(allNodes, pr.originalTarget)} → ${pr.originalTargetHandle ?? 'data'}`
      } else {
        // Outgoing: edge from child(source) -> outside
        // Label the hidden CHILD node's type + source handle
        labels[edgeId] = `${nodeTypeName(allNodes, pr.originalSource)} → ${pr.originalSourceHandle ?? 'data'}`
      }
    }
    return labels
  }, [slotData, d.proxyEdges, allNodes, collapsed])

  /* Toggle collapse / expand --------------------------------------------- */
  const toggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const nextCollapsed = !collapsed
      const groupNode = getNodes().find((n: Node) => n.id === id)
      if (!groupNode) return

      const childList = getNodes().filter((n: Node) => n.parentId === id)
      const cids = new Set(childList.map((c: Node) => c.id))

      const currentW = Number((groupNode as any).style?.width ?? 400)
      const currentH = Number((groupNode as any).style?.height ?? 300)

      // Snapshot child relative positions before collapse
      const positions: Record<string, { x: number; y: number }> = {}
      childList.forEach((c: Node) => { positions[c.id] = { ...c.position } })

      /* Build sorted edge lists for deterministic slot assignment */
      const outEdges = getEdges()
        .filter((ed: Edge) => cids.has(ed.source) && !cids.has(ed.target))
        .sort((a, b) => a.id.localeCompare(b.id))
      const inEdges = getEdges()
        .filter((ed: Edge) => !cids.has(ed.source) && cids.has(ed.target))
        .sort((a, b) => a.id.localeCompare(b.id))

      /* Pill dimensions (auto-fit name + slot rows) ----------------------- */
      const nameStr = String(d.name || 'Group')
      const slotCount = Math.max(inEdges.length, outEdges.length, 1)
      const pillW = Math.max(180, nameStr.length * 9 + 75)
      const pillH = Math.max(64, 36 + slotCount * SLOT_STEP + 20)

      if (nextCollapsed) {
        /* ═══ COLLAPSING ═══════════════════════════════════════════════ */
        const proxyRecords: ProxyEdgeInfo[] = []

        const updatedEdges = getEdges().map((ed: Edge) => {
          const sIn = cids.has(ed.source)
          const tIn = cids.has(ed.target)

          // Internal edge → hide
          if (sIn && tIn) return { ...ed, hidden: true }

          if (sIn) {
            const slot = outEdges.findIndex(e => e.id === ed.id)
            proxyRecords.push({
              edgeId: ed.id,
              originalSource: ed.source,
              originalTarget: ed.target,
              originalSourceHandle: ed.sourceHandle,
              originalTargetHandle: ed.targetHandle,
              side: 'out',
              slot,
            })
            return {
              ...ed,
              source: id,
              sourceHandle: `proxy-out-${slot}`,
            } as Edge
          }

          if (tIn) {
            const slot = inEdges.findIndex(e => e.id === ed.id)
            proxyRecords.push({
              edgeId: ed.id,
              originalSource: ed.source,
              originalTarget: ed.target,
              originalSourceHandle: ed.sourceHandle,
              originalTargetHandle: ed.targetHandle,
              side: 'in',
              slot,
            })
            return {
              ...ed,
              target: id,
              targetHandle: `proxy-in-${slot}`,
            } as Edge
          }

          return ed
        })

        setEdges(updatedEdges)

        setNodes((prev: Node[]) =>
          prev.map((n: Node) => {
            if (n.id === id) {
              return {
                ...n,
                width: pillW,
                height: pillH,
                style: {
                  ...((n as any).style ?? {}),
                  width: pillW,
                  height: pillH,
                  border: '2px solid #3b82f6',
                  borderRadius: 20,
                  borderTopLeftRadius: 20,
                  borderTopRightRadius: 20,
                },
                data: {
                  ...n.data,
                  collapsed: true,
                  originalWidth: currentW,
                  originalHeight: currentH,
                  childPositions: positions,
                  proxyEdges: proxyRecords,
                } as Record<string, unknown>,
              }
            }
            if (n.parentId === id) {
              return {
                ...n,
                style: {
                  ...((n as any).style ?? {}),
                  opacity: 0,
                  pointerEvents: 'none',
                  overflow: 'hidden',
                },
                extent: undefined,
                position: positions[n.id] ?? n.position,
              }
            }
            return n
          })
        )
      } else {
        /* ═══ EXPANDING ════════════════════════════════════════════════ */
        const savedProxies = d.proxyEdges ?? []
        const proxyEdgeIds = new Set(savedProxies.map(p => p.edgeId))

        const updatedEdges = getEdges().map((ed: Edge) => {
          const sIn = cids.has(ed.source)
          const tIn = cids.has(ed.target)

          // Internal edge → show
          if (sIn && tIn) return { ...ed, hidden: false }

          if (proxyEdgeIds.has(ed.id)) {
            const pr = savedProxies.find(p => p.edgeId === ed.id)
            if (!pr) return ed
            const restored: any = { ...ed, hidden: false }
            if (pr.side === 'out') {
              restored.source = pr.originalSource
              restored.sourceHandle = pr.originalSourceHandle
            }
            if (pr.side === 'in') {
              restored.target = pr.originalTarget
              restored.targetHandle = pr.originalTargetHandle
            }
            return restored as Edge
          }

          return ed
        })

        // Remove any edges that still reference this group's proxy handles but were
        // not covered by proxyEdges (stale refs from file corruption or accidental
        // connections to hidden handles).
        const cleanedEdges = updatedEdges.filter(
          ed =>
            !(ed.source === id && ed.sourceHandle?.startsWith('proxy-out-')) &&
            !(ed.target === id && ed.targetHandle?.startsWith('proxy-in-')),
        )

        setEdges(cleanedEdges)

        setNodes((prev: Node[]) =>
          prev.map((n: Node) => {
            if (n.id === id) {
              return {
                ...n,
                width: d.originalWidth ?? currentW,
                height: d.originalHeight ?? currentH,
                style: {
                  ...((n as any).style ?? {}),
                  width: d.originalWidth ?? currentW,
                  height: d.originalHeight ?? currentH,
                  border: '2px dashed #3b82f6',
                  borderRadius: 10,
                },
                data: {
                  ...n.data,
                  collapsed: false,
                  proxyEdges: undefined,
                } as Record<string, unknown>,
              }
            }
            if (n.parentId === id) {
              return {
                ...n,
                style: {
                  ...((n as any).style ?? {}),
                  opacity: undefined,
                  pointerEvents: undefined,
                  overflow: undefined,
                },
                extent: 'parent' as const,
                position: (d.childPositions?.[n.id] ?? positions[n.id] ?? n.position),
              }
            }
            return n
          })
        )
      }

      requestAnimationFrame(() => updateInternals(id))
    },
    [
      collapsed,
      d.name,
      d.proxyEdges,
      d.childPositions,
      d.originalWidth,
      d.originalHeight,
      id,
      getNodes,
      getEdges,
      setNodes,
      setEdges,
      updateInternals,
    ]
  )

  /* ── Register toggle so ToolbarNode can trigger collapse/expand ──────── */
  useEffect(() => {
    registerToggle(id, () => {
      toggleCollapse(new MouseEvent('click') as any)
    })
  }, [id, toggleCollapse])

  /* ── Pre-computed slot / label lookup for render ─────────────────────── */
  const labelFor = (edgeId: string) => proxyLabels[edgeId] ?? ''

  /* ── Render proxy handle slots (always in DOM for registration) ──────── */
  const renderProxyHandles = () => {
    return Array.from({ length: MAX_SLOTS }).map((_, i) => {
      const inEntry = Object.entries(slotData).find(
        ([, v]) => v.side === 'in' && v.slot === i
      )
      const outEntry = Object.entries(slotData).find(
        ([, v]) => v.side === 'out' && v.slot === i
      )

      const inEdgeId = inEntry?.[0]
      const outEdgeId = outEntry?.[0]

      return (
        <div key={`slot-${i}`}>
          {/* Incoming (left) – always registered */}
          <div
            style={{
              position: 'absolute',
              left: -6,
              top: 28 + i * SLOT_STEP,
              display: collapsed && inEdgeId ? 'block' : 'none',
              zIndex: 2,
            }}
          >
            <Handle
              type="target"
              position={Position.Left}
              id={`proxy-in-${i}`}
              style={styles.proxyDot}
              isConnectable={false}
            />
            {collapsed && inEdgeId && (
              <span
                style={{
                  ...styles.proxyLabel,
                  right: 10,
                  textAlign: 'right',
                  transform: 'translateX(-100%)',
                  fontSize: 10,
                  maxWidth: 140,
                }}
              >
                {labelFor(inEdgeId)}
              </span>
            )}
          </div>

          {/* Outgoing (right) – always registered */}
          <div
            style={{
              position: 'absolute',
              right: -6,
              top: 28 + i * SLOT_STEP,
              display: collapsed && outEdgeId ? 'block' : 'none',
              zIndex: 2,
            }}
          >
            <Handle
              type="source"
              position={Position.Right}
              id={`proxy-out-${i}`}
              style={styles.proxyDot}
              isConnectable={false}
            />
            {collapsed && outEdgeId && (
              <span
                style={{
                  ...styles.proxyLabel,
                  left: 10,
                  textAlign: 'left',
                  transform: 'translateX(0)',
                  fontSize: 10,
                  maxWidth: 140,
                }}
              >
                {labelFor(outEdgeId)}
              </span>
            )}
          </div>
        </div>
      )
    })
  }

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <>
      {!collapsed && (
        <NodeResizer
          minWidth={250}
          minHeight={120}
          isVisible={selected}
          lineStyle={{ borderColor: BORDER_COLOR, borderStyle: 'dashed' }}
          handleStyle={{
            background: BORDER_COLOR,
            borderColor: '#fff',
            width: 8,
            height: 8,
          }}
        />
      )}
      <div
        style={{
          ...styles.container,
          ...(collapsed ? styles.collapsed : {}),
        }}
        className="nodrag"
      >
        {/* Header bar (solid blue) always visible */}
        <div style={styles.header}>
          <button
            style={styles.collapseBtn}
            onClick={toggleCollapse}
            title={collapsed ? 'Expand group' : 'Collapse group'}
          >
            {collapsed ? '▶' : '▼'}
          </button>
          <input
            style={styles.title}
            value={String(d.name || 'Group')}
            onChange={e => updateNodeData(id, { name: e.target.value })}
            placeholder="Group name…"
            className="nodrag"
            spellCheck={false}
            onClick={e => e.stopPropagation()}
          />
        </div>

        {/* Proxy handle slots (always rendered for registration, hidden when expanded) */}
        {renderProxyHandles()}
      </div>
    </>
  )
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  container: {
    width:           '100%',
    height:          '100%',
    background:      'rgba(59, 130, 246, 0.06)',
    border:          '2px dashed #3b82f6',
    borderRadius:    10,
    boxSizing:       'border-box',
    position:        'relative',
    overflow:        'visible',
  },
  collapsed: {
    background:      '#3b82f6',
    border:          '2px solid #3b82f6',
    borderRadius:    20,
    display:         'flex',
    flexDirection:   'column',
    alignItems:      'center',
    justifyContent:  'flex-start',
    padding:         '0px 12px 8px 12px',
  },
  header: {
    width:              '100%',
    background:         '#3b82f6',
    borderRadius:       '10px 10px 0 0',
    padding:            '6px 10px',
    display:            'flex',
    alignItems:         'center',
    gap:                6,
    zIndex:             2,
    marginBottom:       4,
  },
  collapseBtn: {
    background:     'transparent',
    border:         'none',
    color:          '#ffffff',
    fontSize:       11,
    cursor:         'pointer',
    lineHeight:     1,
    padding:        0,
    width:          18,
    height:         18,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
    opacity:        0.85,
  },
  title: {
    background:     'transparent',
    border:         'none',
    color:          '#ffffff',
    fontSize:       12,
    fontWeight:     700,
    outline:        'none',
    width:          '100%',
    boxSizing:      'border-box',
    cursor:         'text',
    whiteSpace:     'nowrap',
  },
  proxyDot: {
    width:          12,
    height:         12,
    borderRadius:   '50%',
    background:     '#ffffff',
    border:         '2px solid #3b82f6',
    position:       'static',
    left:           'auto',
    top:            'auto',
    transform:      'none',
  },
  proxyLabel: {
    position:       'absolute',
    top:            '50%',
    marginTop:      -6,
    color:          '#3b82f6',
    whiteSpace:     'nowrap',
    fontWeight:     600,
    background:     'rgba(255,255,255,0.9)',
    padding:        '1px 4px',
    borderRadius:   3,
    lineHeight:     1,
    pointerEvents:  'none',
    overflow:       'hidden',
    textOverflow:   'ellipsis',
  },
}
