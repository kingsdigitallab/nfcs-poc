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

// Parse markdown to React elements: **bold** and *italic*
function parseFormatted(text: string) {
  const parts: (string | JSX.Element)[] = []
  let lastIndex = 0

  // Match **bold** and *italic* (non-greedy)
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    // Add formatted element
    if (match[1]) {
      // **bold**
      parts.push(<strong key={match.index}>{match[1]}</strong>)
    } else {
      // *italic*
      parts.push(<em key={match.index}>{match[2]}</em>)
    }

    lastIndex = regex.lastIndex
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length === 0 ? text : parts
}

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
  const [editMode, setEditMode] = useState<'title' | 'body' | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const isUnlocked = (d.handleUnlocked as boolean | undefined) ?? false
  const showHandles = isUnlocked || clickCount >= 5

  const applyFormatting = (field: 'title' | 'body', format: 'bold' | 'italic') => {
    const ref = field === 'title' ? titleRef : bodyRef
    if (!ref.current) return
    const textarea = ref.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = field === 'title' ? (d.title as string) ?? '' : (d.body as string) ?? ''
    const before = text.slice(0, start)
    const selected = text.slice(start, end)
    const after = text.slice(end)

    if (!selected) return
    const wrapper = format === 'bold' ? '**' : '*'
    const newText = before + wrapper + selected + wrapper + after
    updateNodeData(id, { [field]: newText })

    setTimeout(() => {
      textarea.focus()
      const newStart = start + wrapper.length
      const newEnd = end + wrapper.length
      textarea.setSelectionRange(newStart, newEnd)
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>, field: 'title' | 'body') => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault()
      applyFormatting(field, 'bold')
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault()
      applyFormatting(field, 'italic')
    }
  }

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
      {/* Handles always present for @xyflow/react connection registration; visibility controlled by opacity */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{
          top: '50%',
          opacity: showHandles ? 1 : 0,
          pointerEvents: showHandles ? 'auto' : 'none',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={{
          top: '50%',
          opacity: showHandles ? 1 : 0,
          pointerEvents: showHandles ? 'auto' : 'none',
        }}
      />
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

        {/* Title display or edit */}
        {editMode === 'title' ? (
          <input
            ref={titleRef}
            autoFocus
            style={styles.title}
            value={(d.title as string) ?? ''}
            onChange={e => updateNodeData(id, { title: e.target.value })}
            onKeyDown={e => {
              handleKeyDown(e, 'title')
              if (e.key === 'Enter' || e.key === 'Escape') setEditMode(null)
            }}
            onBlur={() => setEditMode(null)}
            placeholder="Label…"
            className="nodrag"
            spellCheck={false}
          />
        ) : (
          <div
            style={{...styles.title, ...styles.titleDisplay}}
            onClickCapture={handleTitleClick}
            onDoubleClick={() => setEditMode('title')}
            className="nodrag"
            title="Double-click to edit"
          >
            {(d.title as string)?.trim() ? parseFormatted(d.title as string) : <span style={{color: '#d1d5db'}}>Label…</span>}
          </div>
        )}

        <div style={styles.toolbar}>
          <button
            style={styles.formatBtn}
            onMouseDown={() => applyFormatting('body', 'bold')}
            title="Bold (Ctrl+B)"
            className="nodrag"
          >
            <strong>B</strong>
          </button>
          <button
            style={styles.formatBtn}
            onMouseDown={() => applyFormatting('body', 'italic')}
            title="Italic (Ctrl+I)"
            className="nodrag"
          >
            <em>I</em>
          </button>
          <span style={{...styles.formatBtn, ...styles.editorHint, cursor: 'default'}}>Edit</span>
        </div>

        {/* Body display or edit */}
        {editMode === 'body' ? (
          <textarea
            ref={bodyRef}
            autoFocus
            style={styles.body}
            value={(d.body as string) ?? ''}
            onChange={e => updateNodeData(id, { body: e.target.value })}
            onKeyDown={e => handleKeyDown(e, 'body')}
            onBlur={() => setEditMode(null)}
            placeholder="Add a comment or note… Use **text** for bold, *text* for italic"
            className="nodrag nowheel"
            spellCheck={false}
          />
        ) : (
          <div
            style={{...styles.body, ...styles.bodyDisplay}}
            onDoubleClick={() => setEditMode('body')}
            className="nodrag"
            title="Double-click to edit"
          >
            {(d.body as string)?.trim() ? parseFormatted(d.body as string) : <span style={{color: '#d1d5db'}}>Add a comment or note…</span>}
          </div>
        )}
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
  toolbar: {
    background:    HEADER_BG,
    borderBottom:  `1px solid ${BORDER_COLOR}`,
    padding:       '3px 4px',
    display:       'flex',
    gap:           '2px',
    flexShrink:    0,
  },
  formatBtn: {
    background:  '#fcd34d',
    border:      '1px solid #f59e0b',
    borderRadius: 2,
    color:       '#92400e',
    cursor:      'pointer',
    fontSize:    11,
    fontWeight:  700,
    padding:     '2px 4px',
    minWidth:    22,
    height:      20,
    transition:  'background 0.1s',
  },
  titleDisplay: {
    cursor:      'pointer',
    userSelect:  'text' as const,
    wordBreak:   'break-word' as const,
    overflow:    'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace:  'nowrap' as const,
  },
  bodyDisplay: {
    cursor:      'pointer',
    userSelect:  'text' as const,
    wordBreak:   'break-word' as const,
    lineHeight:  1.6,
    whiteSpace:  'pre-wrap' as const,
  },
  editorHint: {
    background:  'transparent',
    border:      'none',
    color:       '#9ca3af',
    fontSize:    9,
    padding:     '2px 3px',
    minWidth:    'unset',
    height:      'auto',
    cursor:      'default',
  },
}
