/**
 * CommentNode — a free-floating annotation label for the canvas.
 *
 * Body text supports **bold** and *italic* markdown syntax. The toolbar
 * wraps selected text; Ctrl+B / Ctrl+I are keyboard shortcuts. The body
 * shows rendered formatting when not being edited, and the raw textarea
 * when focused.
 *
 * Easter egg: click the title field 5 times within 1.5 seconds to unlock
 * hidden input/output handles for illustrating conceptual workflow gaps.
 */

import { useState, useRef } from 'react'
import { useReactFlow, NodeProps, NodeResizer, Handle, Position } from '@xyflow/react'

export interface CommentNodeData {
  title: string
  body: string
  [key: string]: unknown
}

const BORDER_COLOR = '#b3862f'
const HEADER_BG    = '#f6ecd6'
const BODY_BG      = '#faf6ec'

// Parse **bold** and *italic* markdown to React elements
function parseFormatted(text: string): (string | React.JSX.Element)[] {
  const parts: (string | React.JSX.Element)[] = []
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>)
    else           parts.push(<em      key={match.index}>{match[2]}</em>)
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}

export function CommentNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as CommentNodeData

  // Easter egg state
  const [clickCount, setClickCount]   = useState(0)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isUnlocked = (d.handleUnlocked as boolean | undefined) ?? false
  const showHandles = isUnlocked || clickCount >= 5

  // Body focus state for edit/preview toggle
  const [bodyFocused, setBodyFocused] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

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

  const applyFormatting = (format: 'bold' | 'italic') => {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart
    const end   = el.selectionEnd
    if (start === end) return  // nothing selected
    const body   = (d.body as string) ?? ''
    const wrap   = format === 'bold' ? '**' : '*'
    const newBody = body.slice(0, start) + wrap + body.slice(start, end) + wrap + body.slice(end)
    updateNodeData(id, { body: newBody })
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + wrap.length, end + wrap.length)
    }, 0)
  }

  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); applyFormatting('bold') }
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); applyFormatting('italic') }
  }

  const body  = (d.body as string) ?? ''
  const title = (d.title as string) ?? ''

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected}
        lineStyle={{ borderColor: BORDER_COLOR }}
        handleStyle={{ background: BORDER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{ top: '50%', opacity: showHandles ? 1 : 0, pointerEvents: showHandles ? 'auto' : 'none' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={{ top: '50%', opacity: showHandles ? 1 : 0, pointerEvents: showHandles ? 'auto' : 'none' }}
      />
      <div style={styles.card}>

        {/* Drag handle */}
        <div style={styles.dragHandle} title="Drag to move">
          <svg width="24" height="8" viewBox="0 0 24 8" fill="none">
            <circle cx="6"  cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="12" cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="18" cy="2" r="1.5" fill={BORDER_COLOR} />
            <circle cx="6"  cy="6" r="1.5" fill={BORDER_COLOR} />
            <circle cx="12" cy="6" r="1.5" fill={BORDER_COLOR} />
            <circle cx="18" cy="6" r="1.5" fill={BORDER_COLOR} />
          </svg>
        </div>

        {/* Title — always an editable input */}
        <input
          style={styles.title}
          value={title}
          onChange={e => updateNodeData(id, { title: e.target.value })}
          onClickCapture={handleTitleClick}
          placeholder="Label…"
          className="nodrag"
          spellCheck={false}
        />

        {/* Formatting toolbar */}
        <div style={styles.toolbar}>
          <button
            style={styles.formatBtn}
            onMouseDown={e => { e.preventDefault(); applyFormatting('bold') }}
            title="Bold — select text, then click (Ctrl+B)"
            className="nodrag"
          ><strong>B</strong></button>
          <button
            style={styles.formatBtn}
            onMouseDown={e => { e.preventDefault(); applyFormatting('italic') }}
            title="Italic — select text, then click (Ctrl+I)"
            className="nodrag"
          ><em>I</em></button>
        </div>

        {/* Body textarea (shown when focused) */}
        <textarea
          ref={bodyRef}
          style={{ ...styles.body, display: bodyFocused ? 'flex' : 'none' }}
          value={body}
          onChange={e => updateNodeData(id, { body: e.target.value })}
          onFocus={() => setBodyFocused(true)}
          onBlur={() => setBodyFocused(false)}
          onKeyDown={handleBodyKeyDown}
          placeholder="Add a comment or note… Use **text** for bold, *text* for italic"
          className="nodrag nowheel"
          spellCheck={false}
        />

        {/* Body rendered view (shown when not focused) */}
        {!bodyFocused && (
          <div
            style={{ ...styles.body, ...styles.bodyDisplay }}
            onClick={() => { setBodyFocused(true); bodyRef.current?.focus() }}
            className="nodrag"
          >
            {body.trim()
              ? parseFormatted(body)
              : <span style={{ color: '#d1d5db' }}>Add a comment or note…</span>}
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
  dragHandle: {
    background:          HEADER_BG,
    borderBottom:        `1px solid ${BORDER_COLOR}`,
    padding:             '4px 0',
    display:             'flex',
    justifyContent:      'center',
    alignItems:          'center',
    cursor:              'grab' as const,
    flexShrink:          0,
    userSelect:          'none' as const,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
  },
  title: {
    background:   HEADER_BG,
    border:       'none',
    borderBottom: `1px solid ${BORDER_COLOR}`,
    padding:      '5px 10px',
    fontSize:     12,
    fontWeight:   700,
    color:        '#6f4a25',
    outline:      'none',
    width:        '100%',
    boxSizing:    'border-box' as const,
    flexShrink:   0,
  },
  toolbar: {
    background:   HEADER_BG,
    borderBottom: `1px solid ${BORDER_COLOR}`,
    padding:      '3px 4px',
    display:      'flex',
    gap:          '2px',
    flexShrink:   0,
  },
  formatBtn: {
    background:   '#e2c98a',
    border:       '1px solid #b3862f',
    borderRadius: 2,
    color:        '#6f4a25',
    cursor:       'pointer',
    fontSize:     11,
    fontWeight:   700,
    padding:      '2px 6px',
    height:       20,
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
  bodyDisplay: {
    cursor:     'text',
    wordBreak:  'break-word' as const,
    whiteSpace: 'pre-wrap' as const,
    minHeight:  24,
  },
}
