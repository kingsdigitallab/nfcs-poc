/**
 * CitationNode — display-only node that renders a paginated bibliography of
 * individual records in a chosen style (Harvard, APA 7, MLA 9, Chicago
 * author-date). Each card is the formatted reference with the title linked,
 * so what is on screen is exactly what Copy all / Download produce.
 *
 * No runner, no output handle. Place anywhere after a source node.
 */

import { useState, useEffect, useMemo } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import {
  formatAllCitations, formatRecordCitationParts, citableRecords, citationFingerprint,
  CITATION_STYLES, DEFAULT_CITATION_STYLE, isCitationStyle,
  type RecordCitation, type CitationStyle,
} from '../utils/citationUtils'

const HEADER_COLOR = '#6f4a25'
const PAGE_SIZE    = 10

export interface CitationNodeData {
  /** Bibliography style — persisted with the workflow. */
  citationStyle?: CitationStyle
  [key: string]: unknown
}

export function CitationNode({ id, data }: NodeProps) {
  const { records, connected } = useUpstreamRecords(id)
  const { updateNodeData }     = useReactFlow()
  const [page, setCitePage]    = useState(0)
  const [copied, setCopied]    = useState(false)
  const d     = data as CitationNodeData
  const style = isCitationStyle(d.citationStyle) ? d.citationStyle : DEFAULT_CITATION_STYLE

  const recs     = (records ?? []) as Record<string, unknown>[]
  const citable  = useMemo(() => citableRecords(recs), [records])  // eslint-disable-line react-hooks/exhaustive-deps
  const uncited  = recs.length - citable.length
  const pageCount = Math.ceil(citable.length / PAGE_SIZE)
  // Clamp at render time so a shrinking set never leaves the page past the end
  const safePage  = Math.min(page, Math.max(0, pageCount - 1))
  const pageRecs  = citable.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  // Reset to page 0 when the upstream SET changes — keyed on a content
  // fingerprint, not the array (which is a new reference every render).
  const fingerprint = citationFingerprint(citable)
  useEffect(() => { setCitePage(0) }, [fingerprint])

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(formatAllCitations(recs, style))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleDownload = () => {
    const text = formatAllCitations(recs, style)
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `citations-${style}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      <div style={styles.header}>
        <span style={styles.headerTitle}>Citations</span>
        {citable.length > 0 && (
          <span style={styles.headerCount}>
            {citable.length} record{citable.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Style selector — the same string drives the cards, Copy all and Download */}
      <div style={styles.styleRow}>
        <span style={styles.styleLabel}>style</span>
        <select
          style={styles.styleSelect}
          value={style}
          onChange={e => updateNodeData(id, { citationStyle: e.target.value as CitationStyle })}
          className="nodrag"
          title="Bibliography style for the cards, Copy all and Download"
        >
          {(Object.keys(CITATION_STYLES) as CitationStyle[]).map(s => (
            <option key={s} value={s}>{CITATION_STYLES[s].label}</option>
          ))}
        </select>
      </div>

      <div style={styles.body}>
        {!connected && (
          <div style={styles.empty}>Connect a data source to see citations.</div>
        )}
        {connected && citable.length === 0 && recs.length === 0 && (
          <div style={styles.empty}>Run your source nodes first — no records yet.</div>
        )}
        {connected && citable.length === 0 && recs.length > 0 && (
          <div style={styles.empty}>
            No citation metadata found. Records from the search nodes carry citations; file and folder sources do not.
          </div>
        )}

        {pageRecs.map((r, i) => {
          const c     = r._citation as RecordCitation
          const parts = formatRecordCitationParts(c, style)
          // The record page when there is one — the reference's own link may be the DOI or service homepage
          const href  = c.url || (c.pid && /^https?:\/\//.test(c.pid) ? c.pid : undefined)

          return (
            <div key={c.recordId ?? String(safePage * PAGE_SIZE + i)} style={styles.entry}>
              <div style={styles.entryTop}>
                <span style={styles.badge}>{c.service}</span>
                {c.date && <span style={styles.entryDate}>{c.date}</span>}
              </div>

              <div style={styles.reference} className="nodrag">
                {parts.before}
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" style={styles.titleLink} title={c.title}>
                    {parts.title}
                  </a>
                ) : (
                  <span style={styles.title}>{parts.title}</span>
                )}
                {parts.after}
              </div>
            </div>
          )
        })}

        {uncited > 0 && citable.length > 0 && (
          <div style={styles.uncited}>
            + {uncited} record{uncited !== 1 ? 's' : ''} without citation metadata
          </div>
        )}
      </div>

      {pageCount > 1 && (
        <div style={styles.pagination}>
          <button
            style={{ ...styles.pageBtn, opacity: safePage === 0 ? 0.35 : 1 }}
            disabled={safePage === 0}
            onClick={() => setCitePage(safePage - 1)}
            className="nodrag"
          >
            ‹ Prev
          </button>
          <span style={styles.pageLabel}>{safePage + 1} / {pageCount}</span>
          <button
            style={{ ...styles.pageBtn, opacity: safePage >= pageCount - 1 ? 0.35 : 1 }}
            disabled={safePage >= pageCount - 1}
            onClick={() => setCitePage(safePage + 1)}
            className="nodrag"
          >
            Next ›
          </button>
        </div>
      )}

      {citable.length > 0 && (
        <div style={styles.footer}>
          <button style={styles.btn} onClick={handleCopyAll} className="nodrag">
            {copied ? '✓ Copied' : 'Copy all'}
          </button>
          <button style={styles.btn} onClick={handleDownload} className="nodrag">
            Download .txt
          </button>
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fffdf7',
    border:       '2px solid #d6ccb5',
    borderRadius: 8,
    width:        340,
    boxShadow:    '0 1px 4px rgba(50,42,26,0.10)',
    position:     'relative' as const,
  },
  header: {
    height:         32,
    background:     HEADER_COLOR,
    borderRadius:   '6px 6px 0 0',
    padding:        '0 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  headerTitle: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  headerCount: {
    fontSize:   10,
    color:      '#fde68a',
    fontWeight: 600,
  },
  body: {
    padding:       '8px 10px 4px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
    maxHeight:     380,
    overflowY:     'auto' as const,
  },
  empty: {
    fontSize:  11,
    color:     '#b0a891',
    fontStyle: 'italic',
    lineHeight: 1.5,
    padding:   '4px 0',
  },
  entry: {
    background:    '#fffbeb',
    border:        '1px solid #fde68a',
    borderRadius:  5,
    padding:       '6px 8px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           3,
  },
  entryTop: {
    display:    'flex',
    gap:        6,
    alignItems: 'center',
  },
  badge: {
    fontSize:     9,
    fontWeight:   700,
    color:        '#fff',
    background:   HEADER_COLOR,
    borderRadius: 3,
    padding:      '1px 5px',
    flexShrink:   0,
    letterSpacing: '0.02em',
    textTransform: 'uppercase' as const,
  },
  entryDate: {
    fontSize: 10,
    color:    '#8a8168',
  },
  styleRow: {
    display:      'flex',
    alignItems:   'center',
    gap:          6,
    padding:      '5px 10px',
    background:   '#faf6ec',
    borderBottom: '1px solid #ece3d0',
  },
  styleLabel: {
    fontSize:   10,
    color:      '#8a8168',
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  styleSelect: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d6ccb5',
    borderRadius: 4,
    background:   '#fffdf7',
    outline:      'none',
    height:       22,
  },
  // The formatted reference; selectable so a single entry can be copied
  // (React Flow sets user-select:none on nodes — the card is nodrag).
  reference: {
    fontSize:   10.5,
    color:      '#33302a',
    lineHeight: 1.45,
    wordBreak:  'break-word' as const,
    userSelect: 'text' as const,
    cursor:     'text',
  },
  titleLink: {
    fontWeight:     600,
    color:          '#1d4ed8',
    textDecoration: 'none',
  },
  title: {
    fontWeight: 600,
    color:      '#2c2a24',
  },
  uncited: {
    fontSize:  10,
    color:     '#b0a891',
    fontStyle: 'italic',
    padding:   '2px 0',
  },
  pagination: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    gap:            10,
    padding:        '5px 10px',
    borderTop:      '1px solid #f3f4f6',
  },
  pageBtn: {
    fontSize:     11,
    fontWeight:   600,
    color:        HEADER_COLOR,
    background:   'transparent',
    border:       'none',
    cursor:       'pointer',
    padding:      '2px 6px',
  },
  pageLabel: {
    fontSize: 10,
    color:    '#8a8168',
  },
  footer: {
    padding:        '5px 8px 7px',
    display:        'flex',
    gap:            6,
    justifyContent: 'flex-end',
    borderTop:      '1px solid #f3f4f6',
  },
  btn: {
    fontSize:     11,
    fontWeight:   600,
    color:        '#fff',
    background:   HEADER_COLOR,
    border:       'none',
    borderRadius: 4,
    padding:      '3px 10px',
    cursor:       'pointer',
  },
  inputHandle: {
    width:        8,
    height:       8,
    background:   HEADER_COLOR,
    border:       '2px solid #fff',
    boxShadow:    `0 0 0 1px ${HEADER_COLOR}`,
    position:     'absolute' as const,
    left:         -5,
    borderRadius: '50%',
  },
}
