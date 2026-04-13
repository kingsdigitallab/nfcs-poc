/**
 * ReconciledCell — renders a ReconciliationResult as a coloured pill with a
 * clickable Wikidata QID link.  Used by both TableOutputNode and
 * ExpandedOutputPanel so the visual treatment is consistent.
 */
import type { ReconciliationResult } from '../utils/reconciliationService'

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
