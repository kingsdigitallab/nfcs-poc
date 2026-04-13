/**
 * ReconciledCell — shared cell-rendering utilities for TableOutputNode and
 * ExpandedOutputPanel.
 *
 * renderCell() is the single entry point for all table cells:
 *   • ReconciliationResult  → coloured QID pill with Wikidata link
 *   • URL string            → clickable external link
 *   • Array                 → comma-joined; URL items become links
 *   • null / undefined      → em dash
 *   • everything else       → String(val)
 */
import { useState }                  from 'react'
import { createPortal }              from 'react-dom'
import type { ReconciliationResult } from '../utils/reconciliationService'
import { isReconciledValue }         from '../utils/reconciliationService'

// ─── URL detection ─────────────────────────────────────────────────────────────

function isUrl(val: unknown): val is string {
  return typeof val === 'string' &&
    (val.startsWith('https://') || val.startsWith('http://'))
}

// ─── link component ────────────────────────────────────────────────────────────

function ExternalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{ color: '#2563eb', textDecoration: 'none' }}
      title={href}
      onClick={e => e.stopPropagation()}
      className="nodrag"
    >
      {href}
    </a>
  )
}

// ─── reconciled pill ───────────────────────────────────────────────────────────

export function ReconciledPill({ value }: { value: ReconciliationResult }) {
  const resolved  = value.status === 'resolved'
  const bg        = resolved ? '#dcfce7' : '#fef9c3'
  const border    = resolved ? '#86efac' : '#fde68a'
  const color     = resolved ? '#15803d' : '#92400e'
  const label     = value.label ?? value.qid ?? '?'
  const pct       = Math.round(value.confidence * 100)
  const showLabel = label !== value.qid

  return (
    <span style={{
      display:      'inline-flex',
      alignItems:   'center',
      gap:          4,
      background:   bg,
      border:       `1px solid ${border}`,
      borderRadius: 10,
      padding:      '1px 6px',
      fontSize:     10,
      fontWeight:   600,
      color,
      whiteSpace:   'nowrap',
    }}>
      {value.qid ? (
        <a
          href={`https://www.wikidata.org/wiki/${value.qid}`}
          target="_blank"
          rel="noreferrer"
          style={{ color, textDecoration: 'none' }}
          onClick={e => e.stopPropagation()}
          className="nodrag"
        >
          {value.qid}
        </a>
      ) : null}
      {value.qid && showLabel ? <span style={{ opacity: 0.75 }}>·</span> : null}
      {showLabel ? <span>{label}</span> : null}
      <span style={{ opacity: 0.6, fontSize: 9 }}>{pct}%</span>
    </span>
  )
}

// ─── candidate picker pill ─────────────────────────────────────────────────────

/**
 * Like ReconciledPill but, when multiple candidates exist, shows a popover
 * on click so the user can choose a different match.
 */
export function SelectableReconciledPill({
  value,
  onSelect,
}: {
  value:    ReconciliationResult
  onSelect: (result: ReconciliationResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ x: 0, y: 0 })

  const hasChoices = value.candidates.length > 1

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (!hasChoices) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setPos({ x: rect.left, y: rect.bottom + 4 })
    setOpen(o => !o)
  }

  function pick(c: ReconciliationResult['candidates'][number]) {
    onSelect({
      ...value,
      qid:        c.qid,
      label:      c.label,
      description: null,
      confidence: c.score,
      status:     'resolved',
    })
    setOpen(false)
  }

  return (
    <>
      <span
        onClick={handleClick}
        style={{ cursor: hasChoices ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 2 }}
        title={hasChoices ? 'Click to choose from candidates' : undefined}
        className="nodrag"
      >
        <ReconciledPill value={value} />
        {hasChoices && (
          <span style={{ fontSize: 9, opacity: 0.6, lineHeight: 1 }}>▾</span>
        )}
      </span>

      {open && createPortal(
        <>
          {/* backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setOpen(false)}
          />
          {/* popover */}
          <div style={{
            position:     'fixed',
            top:          pos.y,
            left:         pos.x,
            zIndex:       9999,
            background:   '#fff',
            border:       '1px solid #e5e7eb',
            borderRadius: 6,
            boxShadow:    '0 4px 16px rgba(0,0,0,0.15)',
            minWidth:     240,
            overflow:     'hidden',
          }}>
            <div style={{ fontSize: 10, color: '#6b7280', padding: '5px 10px', borderBottom: '1px solid #f3f4f6', fontWeight: 600 }}>
              Choose reconciliation match
            </div>
            {value.candidates.map(c => {
              const active = c.qid === value.qid
              return (
                <button
                  key={c.qid}
                  onClick={e => { e.stopPropagation(); pick(c) }}
                  style={{
                    display:    'flex',
                    width:      '100%',
                    alignItems: 'center',
                    gap:        6,
                    padding:    '6px 10px',
                    background: active ? '#f0fdf4' : 'transparent',
                    border:     'none',
                    borderBottom: '1px solid #f9fafb',
                    cursor:     'pointer',
                    textAlign:  'left',
                    fontSize:   11,
                  }}
                >
                  <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: '50%', background: active ? '#22c55e' : '#d1d5db' }} />
                  <span style={{ fontWeight: 600, color: '#111827', flexGrow: 1 }}>{c.label}</span>
                  <span style={{ color: '#9ca3af', fontSize: 10, flexShrink: 0 }}>{c.qid}</span>
                  <span style={{ color: '#6b7280', fontSize: 10, flexShrink: 0, marginLeft: 4 }}>
                    {Math.round(c.score * 100)}%
                  </span>
                </button>
              )
            })}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}

// ─── universal cell renderer ───────────────────────────────────────────────────

export function renderCell(
  val: unknown,
  onSelectReconciled?: (result: ReconciliationResult) => void,
): React.ReactNode {
  // Reconciled object → selectable pill (if handler provided) or plain pill
  if (isReconciledValue(val)) {
    if (onSelectReconciled && val.candidates.length > 1) {
      return <SelectableReconciledPill value={val} onSelect={onSelectReconciled} />
    }
    return <ReconciledPill value={val} />
  }

  // URL string → external link
  if (isUrl(val)) return <ExternalLink href={val} />

  // Array — join with commas; URL items become links
  if (Array.isArray(val)) {
    if (val.length === 0) return '—'
    const hasUrls = val.some(isUrl)
    if (!hasUrls) return val.join(', ')
    return (
      <>
        {val.map((item, i) => (
          <span key={i}>
            {i > 0 && <span style={{ color: '#9ca3af' }}>, </span>}
            {isUrl(item) ? <ExternalLink href={item} /> : String(item)}
          </span>
        ))}
      </>
    )
  }

  // Null / undefined → em dash
  if (val === null || val === undefined) return '—'

  // Fallback
  return String(val)
}
