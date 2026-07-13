/**
 * useGrouping — group/ungroup actions and the group auto-resize effect,
 * extracted verbatim from App.tsx (task 5.6 decomposition).
 */
import { useCallback, useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Node, ReactFlowInstance } from '@xyflow/react'
import { newId } from '../utils/nodeIdCounter'
import { invokeToggle } from '../utils/groupToggleRegistry'
import type { AppNode } from '../types/AppNode'

export function useGrouping(
  rfInstance: ReactFlowInstance | null,
  nodes: AppNode[],
  setNodes: Dispatch<SetStateAction<AppNode[]>>,
) {
  // Auto-resize groups to fit children. Bidirectional (grows AND shrinks) so
  // that no stale dimensions linger across collapse/expand cycles. The previous
  // grow-only behaviour meant a group resized larger by NodeResizer would stay
  // large after expand, and the next collapse would briefly draw the old big
  // outline before the pill size took effect.
  // A 4px tolerance prevents setNodes/measured-resync feedback loops.
  // Debounced (120ms): during token-by-token LLM streaming, a child's measured
  // size can change many times per second — recomputing on every intermediate
  // frame makes the group visibly chase the stream and can lock in a mid-stream
  // width/height peak. Waiting for the content to settle before committing means
  // the group sizes to the node's actual final footprint instead.
  const groupResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const groups = nodes.filter(n => n.type === 'group')
    if (groups.length === 0) return

    if (groupResizeTimerRef.current) clearTimeout(groupResizeTimerRef.current)
    groupResizeTimerRef.current = setTimeout(() => {
      setNodes(currentNodes => {
        const TOLERANCE = 4
        const updated = currentNodes.map(node => {
          if (node.type !== 'group') return node
          if ((node.data as any).collapsed) return node

          const children = currentNodes.filter(n => n.parentId === node.id)
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

        const changed = updated.some((n, i) => n !== currentNodes[i])
        return changed ? updated : currentNodes
      })
    }, 120)

    return () => {
      if (groupResizeTimerRef.current) clearTimeout(groupResizeTimerRef.current)
    }
  }, [nodes, setNodes])

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
    setNodes([groupNode, ...updatedNodes] as AppNode[])
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

    setNodes(updatedNodes.filter(n => n.id !== selectedGroup.id) as AppNode[])
  }, [rfInstance, setNodes])

  return { handleGroupSelected, handleUngroup }
}
