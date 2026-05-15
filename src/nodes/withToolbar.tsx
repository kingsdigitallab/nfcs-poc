import React from 'react'
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { invokeToggle } from '../utils/groupToggleRegistry'
import { newId } from '../utils/nodeIdCounter'

// Fields that are runtime-only and should not be copied to the duplicate.
const RUNTIME_FIELDS = new Set([
  'results', 'status', 'statusMessage', 'count',
  'inputCount', 'outputCount', 'removedCount',
  'resolvedCount', 'reviewCount',
  'resultsVersion', '_capped', '_total',
  'folderName', 'fileName', 'columnNames',
  'pdfCount', 'xmlCount', 'textCount', 'imageCount',
  'filterCount', 'totalCount',
])

export function withToolbar(Wrapped: React.ComponentType<NodeProps>): React.ComponentType<NodeProps> {
  function ToolbarNode(props: NodeProps) {
    const { getNodes, setNodes, getEdges, setEdges, deleteElements } = useReactFlow()
    const isGroup = props.type === 'group'
    const d = props.data as Record<string, unknown>
    const collapsed = !!d.collapsed

    const handleDuplicate = (e: React.MouseEvent) => {
      e.stopPropagation()
      const all = getNodes()
      const edges = getEdges()
      const node = all.find(n => n.id === props.id)
      if (!node) return

      const cloneData = (data: object) => Object.fromEntries(
        Object.entries(structuredClone(data)).filter(([k]) => !RUNTIME_FIELDS.has(k))
      )

      setNodes(prevNodes => {
        const base = prevNodes.map(n => ({ ...n, selected: false }))

        if (node.type === 'group') {
          const children = prevNodes.filter(n => n.parentId === node.id)
          const childIds = new Set(children.map(c => c.id))
          const groupId = newId('group')
          const idMap = new Map([[node.id, groupId]])

          const newGroup = {
            ...node,
            id: groupId,
            position: { x: node.position.x + 40, y: node.position.y + 40 },
            selected: true,
            data: cloneData(node.data as object),
          }

          const clonedChildren = children.map(child => {
            const newId_val = newId(child.type ?? 'node')
            idMap.set(child.id, newId_val)
            return {
              ...child,
              id: newId_val,
              parentId: groupId,
              position: { x: child.position.x, y: child.position.y },
              extent: child.extent,
              data: cloneData(child.data as object),
            }
          })

          const internalEdges = edges.filter(
            ed => childIds.has(ed.source) && childIds.has(ed.target)
          )

          const clonedEdges = internalEdges.map(ed => ({
            ...ed,
            id: newId('edge'),
            source: idMap.get(ed.source)!,
            target: idMap.get(ed.target)!,
          }))

          if (clonedEdges.length > 0) {
            setEdges(prevEdges => [...prevEdges, ...clonedEdges])
          }

          return [...base, newGroup, ...clonedChildren]
        }

        const newNode = {
          ...node,
          id: newId(node.type ?? 'node'),
          position: { x: node.position.x + 40, y: node.position.y + 40 },
          selected: true,
          data: cloneData(node.data as object),
        }

        return [...base, newNode]
      })
    }

    const handleDelete = (e: React.MouseEvent) => {
      e.stopPropagation()
      deleteElements({ nodes: [{ id: props.id }] })
    }

    const handleToggleCollapse = (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!isGroup) return
      invokeToggle(props.id)
    }

    return (
      <>
        <NodeToolbar position={Position.Top} align="end" style={toolbarStyle}>
          {isGroup && (
            <button
              style={btnStyle}
              onClick={handleToggleCollapse}
              title={collapsed ? 'Expand group' : 'Collapse group'}
            >
              {collapsed ? '▶' : '▼'}
            </button>
          )}
          <button style={btnStyle} onClick={handleDuplicate} title="Duplicate node">
            ⧉
          </button>
          <button style={{ ...btnStyle, marginLeft: 4 }} onClick={handleDelete} title="Delete node">
            🗑
          </button>
        </NodeToolbar>
        <Wrapped {...props} />
      </>
    )
  }

  ToolbarNode.displayName = `withToolbar(${Wrapped.displayName ?? Wrapped.name ?? 'Node'})`
  return ToolbarNode
}

const toolbarStyle: React.CSSProperties = {
  padding: 0,
  display: 'flex',
  gap: 4,
}

const btnStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: '3px 7px',
  color: '#6b7280',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
  transition: 'background 0.12s, color 0.12s',
}
