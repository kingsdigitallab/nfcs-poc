/**
 * CommentNode — a free-floating annotation label for the canvas.
 *
 * Easter egg: click the title field 5 times within 1.5 seconds to unlock hidden
 * input/output handles. When unlocked, passes data through unaltered and shows
 * input/output connectors — useful for illustrating conceptual workflow gaps
 * that aren't yet implementable (e.g., "data retrieval" node between metadata
 * source and processing nodes).
 */

import { useState, useRef } from 'react'
import { useReactFlow, NodeProps, NodeResizer, Handle, Position } from '@xyflow/react'

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
  const [clickCount, setClickCount] = useState(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUnlocked = (d.handleUnlocked as boolean | undefined) ?? false
  const showHandles = isUnlocked || clickCount >= 5

  const handleTitleClick = () => {
    if (isUnlocked) return
    const newCount = clickCount + 1
    setClickCount(newCount)
    if (clickTimer.current) clearTimeout(clickTimer.current)
    if (newCount >= 5) {
      updateNodeData(id, { handleUnlocked: true })
    } else {
      clickTimer.current = setTimeout(() => setClickCount(0), 1500)
    }
  }

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected}
        lineStyle={{ borderColor: BORDER_COLOR }}
        handleStyle={{ background: BORDER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      {showHandles && (
        <>
          <Handle type="target" position={Position.Left} id="data" style={{ top: '50%' }} />
          <Handle type="source" position={Position.Right} id="results" style={{ top: '50%' }} />
        </>
      )}
      <div style={styles.card}>
        <div style={styles.dragHandle} title="Drag to move">
          <svg width="24" height="8" viewBox="0 0 24 8" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6" cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="12" cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="18" cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="6" cy="6" r="1.5" fill={BORDER_COLOR} />
            <circle cx="12" cy="6" r="1.5" fill={BORDER_COLOR} />
            <circle cx="18" cy="6" r="1.5" fill={BORDER_COLOR} />
          </svg>
        </div>
        <input
          style={{...styles.title, cursor: 'text'}}
          value={(d.title as string) ?? ''}
          onChange={e => updateNodeData(id, { title: e.target.value })}
          onClickCapture={handleTitleClick}
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
  dragHandle: {
    background:   HEADER_BG,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    padding:      '4px 0',
    display:      'flex',
    justifyContent: 'center',
    alignItems:   'center',
    cursor:       'grab' as const,
    flexShrink:   0,
    userSelect:   'none' as const,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
}
