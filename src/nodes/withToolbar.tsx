import React from 'react'
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { invokeToggle } from '../utils/groupToggleRegistry'
import { duplicateNodes } from '../utils/duplicateNodes'

export function withToolbar(Wrapped: React.ComponentType<NodeProps>): React.ComponentType<NodeProps> {
  function ToolbarNode(props: NodeProps) {
    const { getNodes, setNodes, getEdges, setEdges, deleteElements } = useReactFlow()
    const isGroup = props.type === 'group'
    const d = props.data as Record<string, unknown>
    const collapsed = !!d.collapsed

    // Same implementation as Ctrl+D (useDuplicateSelection), for this one node.
    // The clone set is computed here, outside the updaters, so ids are minted
    // once even when StrictMode runs an updater twice.
    const handleDuplicate = (e: React.MouseEvent) => {
      e.stopPropagation()
      const { nodes: added, edges: addedEdges, skipped } = duplicateNodes(getNodes(), getEdges(), [props.id])
      if (skipped.length > 0) { invokeToggle(props.id); return }   // collapsed group: expand first, as delete does
      if (added.length === 0) return
      setNodes(prev => [...prev.map(n => (n.selected ? { ...n, selected: false } : n)), ...added])
      if (addedEdges.length > 0) setEdges(prev => [...prev, ...addedEdges])
    }

    const handleDelete = (e: React.MouseEvent) => {
      e.stopPropagation()

      // Groups need special handling. Direct deletion would either:
      //  (a) orphan children (parentId pointing to a deleted node), or
      //  (b) silently drop child work along with the group.
      // Behaviour: while collapsed, expand first (matches handleUngroup).
      // While expanded, unparent children (preserve them) before removing
      // the group node itself.
      if (isGroup) {
        if (collapsed) {
          invokeToggle(props.id)
          return
        }
        const groupNode = getNodes().find(n => n.id === props.id)
        if (!groupNode) return
        const groupPos = groupNode.position
        setNodes(prev =>
          prev
            .map(n => {
              if (n.parentId !== props.id) return n
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
            .filter(n => n.id !== props.id),
        )
        return
      }

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
  background: '#fffdf7',
  border: '1px solid #d6ccb5',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: 1,
  padding: '3px 7px',
  color: '#8a8168',
  boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
  transition: 'background 0.12s, color 0.12s',
}
