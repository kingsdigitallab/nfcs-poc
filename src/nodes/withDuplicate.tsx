import React from 'react'
import { NodeToolbar, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { newId } from '../utils/nodeIdCounter'

// Fields that are runtime-only and should not be copied to the duplicate.
// Configuration fields (queries, prompts, ops, field names, etc.) are preserved.
const RUNTIME_FIELDS = new Set([
  'results', 'status', 'statusMessage', 'count',
  'inputCount', 'outputCount', 'removedCount',
  'resolvedCount', 'reviewCount',
  'resultsVersion', '_capped', '_total',
  'folderName', 'fileName', 'columnNames',
  'pdfCount', 'xmlCount', 'textCount', 'imageCount',
  'filterCount', 'totalCount',
])

export function withDuplicate(Wrapped: React.ComponentType<NodeProps>): React.ComponentType<NodeProps> {
  function DuplicableNode(props: NodeProps) {
    const { getNodes, setNodes } = useReactFlow()

    const handleDuplicate = (e: React.MouseEvent) => {
      e.stopPropagation()
      const node = getNodes().find(n => n.id === props.id)
      if (!node) return

      const cleanData = Object.fromEntries(
        Object.entries(structuredClone(node.data as object))
          .filter(([k]) => !RUNTIME_FIELDS.has(k))
      )

      const newNode = {
        ...node,
        id:       newId(node.type ?? 'node'),
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        selected: true,
        data:     cleanData,
      }

      setNodes(prev => [
        ...prev.map(n => n.id === node.id ? { ...n, selected: false } : n),
        newNode,
      ])
    }

    return (
      <>
        <NodeToolbar position={Position.Top} align="end" style={toolbarStyle}>
          <button style={btnStyle} onClick={handleDuplicate} title="Duplicate node">
            ⧉
          </button>
        </NodeToolbar>
        <Wrapped {...props} />
      </>
    )
  }

  DuplicableNode.displayName = `withDuplicate(${Wrapped.displayName ?? Wrapped.name ?? 'Node'})`
  return DuplicableNode
}

const toolbarStyle: React.CSSProperties = {
  padding: 0,
}

const btnStyle: React.CSSProperties = {
  background:   '#fffdf7',
  border:       '1px solid #d6ccb5',
  borderRadius: 5,
  cursor:       'pointer',
  fontSize:     15,
  lineHeight:   1,
  padding:      '3px 7px',
  color:        '#8a8168',
  boxShadow:    '0 1px 4px rgba(0,0,0,0.12)',
  transition:   'background 0.12s, color 0.12s',
}
