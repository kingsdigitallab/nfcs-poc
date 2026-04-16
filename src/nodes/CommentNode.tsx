/**
 * CommentNode — a free-floating annotation label for the canvas.
 * No input or output handles. Drag to position; resize by dragging the
 * bottom-right corner of the text area.
 */

import { useReactFlow, NodeProps, NodeResizer } from '@xyflow/react'

export interface CommentNodeData {
  title: string
  body: string
  [key: string]: unknown
}

const BORDER_COLOR  = '#fbbf24'
const HEADER_BG     = '#fef3c7'
const BODY_BG       = '#fffbeb'

export function CommentNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as CommentNodeData

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected}
        lineStyle={{ borderColor: BORDER_COLOR }}
        handleStyle={{ background: BORDER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={styles.card}>
        <input
          style={styles.title}
          value={(d.title as string) ?? ''}
          onChange={e => updateNodeData(id, { title: e.target.value })}
          placeholder="Label…"
          className="nodrag"
          spellCheck={false}
        />
        <textarea
          style={styles.body}
          value={(d.body as string) ?? ''}
          onChange={e => updateNodeData(id, { body: e.target.value })}
          placeholder="Add a comment or note…"
          className="nodrag nowheel"
          spellCheck={false}
        />
      </div>
    </>
  )
}

const styles = {
  card: {
    width:         '100%',
    height:        '100%',
    minWidth:      180,
    minHeight:     80,
    background:    BODY_BG,
    border:        `2px solid ${BORDER_COLOR}`,
    borderRadius:  8,
    boxShadow:     '2px 3px 8px rgba(0,0,0,0.10)',
    display:       'flex',
    flexDirection: 'column' as const,
    overflow:      'hidden',
  },
  title: {
    background:   HEADER_BG,
    border:       'none',
    borderBottom: `1px solid ${BORDER_COLOR}`,
    padding:      '5px 10px',
    fontSize:     12,
    fontWeight:   700,
    color:        '#92400e',
    outline:      'none',
    width:        '100%',
    boxSizing:    'border-box' as const,
    flexShrink:   0,
  },
  body: {
    flex:        1,
    background:  'transparent',
    border:      'none',
    padding:     '7px 10px',
    fontSize:    12,
    color:       '#374151',
    lineHeight:  1.6,
    resize:      'none' as const,
    outline:     'none',
    width:       '100%',
    boxSizing:   'border-box' as const,
    fontFamily:  'inherit',
  },
}
