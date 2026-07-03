/**
 * CitationNode — display-only node that renders a paginated bibliography of
 * individual records. Each entry shows title (linked), creator, date, service,
 * persistent identifier / URL, and access date.
 *
 * No runner, no output handle. Place anywhere after a source node.
 */

import { useState, useEffect, useMemo } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { formatAllCitations, type RecordCitation } from '../utils/citationUtils'

const HEADER_COLOR = '#6f4a25'
const PAGE_SIZE    = 10

export interface CitationNodeData {
  [key: string]: unknown
}

export function CitationNode({ id }: NodeProps) {
  const { records, connected } = useUpstreamRecords(id)
  const [page, setCitePage]    = useState(0)
  const [copied, setCopied]    = useState(false)

  const recs     = (records ?? []) as Record<string, unknown>[]
  const citable  = useMemo(
    () => recs.filter(r => r._citation && typeof r._citation === 'object' && !Array.isArray(r._citation)),
    [recs],
  )
  const uncited  = recs.length - citable.length
  const pageCount = Math.ceil(citable.length / PAGE_SIZE)
  const pageRecs  = citable.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset to page 0 when upstream records change
  useEffect(() => { setCitePage(0) }, [records])

  const handleCopyAll = async () => {
    await navigator.clipboard.writeText(formatAllCitations(recs))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const handleDownload = () => {
    const text = formatAllCitations(recs)
    const blob = new Blob([text], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = 'citations.txt'
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

      <div style={styles.body}>
        {!connected && (
          <div style={styles.empty}>Connect a data source to see citations.</div>
        )}
        {connected && citable.length === 0 && recs.length === 0 && (
          <div style={styles.empty}>Run your source nodes first — no records yet.</div>
        )}
        {connected && citable.length === 0 && recs.length > 0 && (
          <div style={styles.empty}>
            No citation metadata found. Only records from GBIF, ADS, LLDS, MDS, and ADS Library carry citations.
          </div>
        )}

        {pageRecs.map((r, i) => {
          const c        = r._citation as RecordCitation
          const link     = c.pid || c.url
          const creators = Array.isArray(c.creator) ? c.creator.join('; ') : c.creator

          return (
            <div key={c.recordId ?? String(page * PAGE_SIZE + i)} style={styles.entry}>
              <div style={styles.entryTop}>
                <span style={styles.badge}>{c.service}</span>
                {c.date && <span style={styles.entryDate}>{c.date}</span>}
              </div>

              {c.title ? (
                link ? (
                  <a
                    href={link}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.titleLink}
                    className="nodrag"
                    title={c.title}
                  >
                    {c.title}
                  </a>
                ) : (
                  <div style={styles.title} title={c.title}>{c.title}</div>
                )
              ) : null}

              {creators && (
                <div style={styles.creator}>{creators}</div>
              )}

              {c.pid && (
                <div style={styles.pidRow}>
                  <span style={styles.metaLabel}>ID</span>
                  <a
                    href={c.pid.startsWith('http') ? c.pid : `https://doi.org/${c.pid.replace(/^doi:/, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.pidLink}
                    className="nodrag"
                  >
                    {c.pid}
                  </a>
                </div>
              )}

              {!c.pid && c.url && (
                <div style={styles.pidRow}>
                  <span style={styles.metaLabel}>URL</span>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    style={styles.pidLink}
                    className="nodrag"
                  >
                    {c.url}
                  </a>
                </div>
              )}

              <div style={styles.accessed}>
                Accessed {new Date(c.accessDate).toLocaleDateString('en-GB', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
                {c.licence && <span style={styles.licence}> · {c.licence}</span>}
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
            style={{ ...styles.pageBtn, opacity: page === 0 ? 0.35 : 1 }}
            disabled={page === 0}
            onClick={() => setCitePage(p => p - 1)}
            className="nodrag"
          >
            ‹ Prev
          </button>
          <span style={styles.pageLabel}>{page + 1} / {pageCount}</span>
          <button
            style={{ ...styles.pageBtn, opacity: page >= pageCount - 1 ? 0.35 : 1 }}
            disabled={page >= pageCount - 1}
            onClick={() => setCitePage(p => p + 1)}
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
  titleLink: {
    fontSize:       11,
    fontWeight:     600,
    color:          '#1d4ed8',
    textDecoration: 'none',
    lineHeight:     1.35,
    display:        '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow:       'hidden',
  },
  title: {
    fontSize:   11,
    fontWeight: 600,
    color:      '#2c2a24',
    lineHeight: 1.35,
    display:    '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical' as const,
    overflow:   'hidden',
  },
  creator: {
    fontSize:   10,
    color:      '#33302a',
    lineHeight: 1.3,
  },
  pidRow: {
    display:    'flex',
    gap:        5,
    alignItems: 'flex-start',
  },
  metaLabel: {
    fontSize:   9,
    color:      '#b0a891',
    fontFamily: 'monospace',
    width:      20,
    flexShrink: 0,
    paddingTop: 1,
    textTransform: 'uppercase' as const,
  },
  pidLink: {
    fontSize:       10,
    color:          '#2563eb',
    textDecoration: 'none',
    wordBreak:      'break-all' as const,
    flex:           1,
    lineHeight:     1.3,
  },
  accessed: {
    fontSize: 9,
    color:    '#b0a891',
    marginTop: 1,
  },
  licence: {
    fontStyle: 'italic',
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
