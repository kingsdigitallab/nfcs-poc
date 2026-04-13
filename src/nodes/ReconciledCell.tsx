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

// ─── universal cell renderer ───────────────────────────────────────────────────

export function renderCell(val: unknown): React.ReactNode {
  // Reconciled object → pill
  if (isReconciledValue(val)) return <ReconciledPill value={val} />

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
