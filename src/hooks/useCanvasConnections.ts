/**
 * useCanvasConnections — edge creation, drag-and-drop node placement, and
 * the connection-suggestion / handle-picker popups, extracted verbatim from
 * App.tsx (task 5.6 decomposition).
 */
import { useCallback, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  addEdge,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type ReactFlowInstance,
} from '@xyflow/react'
import { NODE_DEFAULTS, KCL_API_KEY_NODES, findSharedApiKey } from '../config/nodeDefaults'
import { NODE_PARAM_HANDLES, type Suggestion } from '../components/ConnectionSuggestions'
import type { AppNode } from '../types/AppNode'

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

export interface ConnMenuState {
  x: number; y: number
  sourceNodeId: string; sourceNodeType: string; sourceHandleId: string | null
}

export interface HandlePickerState {
  x: number; y: number
  pendingNodeType: string; pendingColor: string
  sourceNodeId: string; sourceHandleId: string | null
}

export function useCanvasConnections(
  rfInstance: ReactFlowInstance | null,
  reactFlowWrapper: RefObject<HTMLDivElement | null>,
  setNodes: Dispatch<SetStateAction<AppNode[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
) {
  const [connMenu, setConnMenu] = useState<ConnMenuState | null>(null)

  // Second-step handle picker (for param → multi-handle nodes)
  const [handlePicker, setHandlePicker] = useState<HandlePickerState | null>(null)

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
    [rfInstance, reactFlowWrapper, setNodes],
  )

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

  return {
    connMenu, setConnMenu,
    handlePicker, setHandlePicker,
    onConnect, onDragOver, onDrop, onConnectEnd,
    handleSuggestionSelect, handlePickerSelect,
  }
}
