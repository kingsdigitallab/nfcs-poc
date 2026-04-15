/**
 * OllamaOutputNode — dedicated display node for inference output.
 *
 * Receives records enriched with ollamaResponse (from OllamaNode,
 * OllamaFieldNode, or any upstream that adds the field) and renders
 * them as readable response cards. Supports expanding/collapsing long
 * responses and copying individual responses to the clipboard.
 *
 * Pure output node — no pass-through handle, no runner.
 */

import { useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

const HEADER_COLOR = '#0f172a'  // very dark slate

interface OllamaRecord {
  id: string
  title?: string
  ollamaResponse?: string
  ollamaModel?: string
  ollamaField?: string
  ollamaMode?: string
  ollamaAggregatedFrom?: number
  ollamaProcessedAt?: string
  [key: string]: unknown
}

export function OllamaOutputNode({ id }: NodeProps) {
  const { records, connected, status } = useUpstreamRecords(id)
  const [expanded, setExpanded]       = useState<Set<string>>(new Set())
  const [copied,   setCopied]         = useState<string | null>(null)

  const allRecords    = (records ?? []) as OllamaRecord[]
  const withResponse  = allRecords.filter(r => r.ollamaResponse)
  const isAggregate   = withResponse.length === 1 && withResponse[0].ollamaMode === 'aggregate'

  function toggleExpand(recId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(recId)) next.delete(recId)
      else next.add(recId)
      return next
    })
  }

  async function copyResponse(recId: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(recId)
      setTimeout(() => setCopied(prev => prev === recId ? null : prev), 1500)
    } catch { /* clipboard blocked */ }
  }

  function copyAll() {
    const text = withResponse
      .map(r => {
        const header = r.title ?? r.id
        return `## ${header}\n\n${r.ollamaResponse ?? ''}`
      })
      .join('\n\n---\n\n')
    copyResponse('__all__', text)
  }

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Ollama Output</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {withResponse.length > 0 && (
            <span style={styles.badge}>
              {isAggregate
                ? `aggregate · ${withResponse[0].ollamaAggregatedFrom ?? '?'} records`
                : `${withResponse.length} response${withResponse.length !== 1 ? 's' : ''}`}
            </span>
          )}
          {status === 'loading' && (
            <span style={{ ...styles.badge, color: '#93c5fd' }}>loading…</span>
          )}
          {withResponse.length > 1 && (
            <button style={styles.copyAllBtn} onClick={copyAll} className="nodrag">
              {copied === '__all__' ? '✓ Copied' : 'Copy all'}
            </button>
          )}
        </div>
      </div>

      {/* Empty states */}
      {!connected && (
        <div style={styles.placeholder}>
          Connect an Ollama node to view inference output
        </div>
      )}
      {connected && withResponse.length === 0 && (
        <div style={styles.placeholder}>
          {status === 'loading'
            ? 'Waiting for results…'
            : 'Run an Ollama node upstream to see responses here'}
        </div>
      )}

      {/* Response cards */}
      {withResponse.length > 0 && (
        <div style={styles.cardList} className="nodrag nowheel">
          {withResponse.map(rec => {
            const isExp    = expanded.has(rec.id)
            const response = rec.ollamaResponse ?? ''
            const preview  = isExp ? response : response.slice(0, 400)
            const truncated = !isExp && response.length > 400

            // Build a meaningful title
            const cardTitle = rec.title
              ?? (rec.ollamaField ? `[${rec.ollamaField}] ${rec.id}` : rec.id)

            return (
              <div key={rec.id} style={styles.responseCard}>
                {/* Card header row */}
                <div style={styles.cardTop}>
                  <div style={styles.cardTitle} title={String(cardTitle)}>
                    {String(cardTitle)}
                  </div>
                  <div style={styles.cardActions}>
                    <button
                      style={{ ...styles.actionBtn, color: copied === rec.id ? '#16a34a' : '#6b7280' }}
                      onClick={() => copyResponse(rec.id, response)}
                      title="Copy response"
                      className="nodrag"
                    >
                      {copied === rec.id ? '✓' : '⧉'}
                    </button>
                  </div>
                </div>

                {/* Meta pills */}
                <div style={styles.metaRow}>
                  {rec.ollamaModel && (
                    <span style={styles.metaPill}>{rec.ollamaModel}</span>
                  )}
                  {rec.ollamaField && (
                    <span style={{ ...styles.metaPill, background: '#ede9fe', color: '#6d28d9' }}>
                      field: {rec.ollamaField}
                    </span>
                  )}
                  {rec.ollamaMode === 'aggregate' && (
                    <span style={{ ...styles.metaPill, background: '#fef3c7', color: '#92400e' }}>
                      {rec.ollamaAggregatedFrom} records aggregated
                    </span>
                  )}
                </div>

                {/* Response text */}
                <div style={styles.responseText}>
                  {preview}{truncated ? '…' : ''}
                </div>

                {response.length > 400 && (
                  <button style={styles.expandBtn} onClick={() => toggleExpand(rec.id)} className="nodrag">
                    {isExp ? '▲ Show less' : `▼ Show all (${response.length.toLocaleString()} chars)`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth: 380,
    maxWidth: 540,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  header: {
    background: HEADER_COLOR,
    padding: '0 10px',
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
  },
  badge: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: 600,
  },
  copyAllBtn: {
    fontSize: 10,
    color: '#cbd5e1',
    background: 'transparent',
    border: '1px solid #334155',
    borderRadius: 4,
    padding: '1px 7px',
    cursor: 'pointer',
  },
  placeholder: {
    padding: '20px 16px',
    color: '#9ca3af',
    fontSize: 12,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 0,
    maxHeight: 480,
    overflowY: 'auto' as const,
  },
  responseCard: {
    padding: '10px 12px',
    borderBottom: '1px solid #f0f0f0',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 5,
  },
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: '#1e293b',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
  },
  cardActions: {
    display: 'flex',
    gap: 4,
    flexShrink: 0,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 2px',
    lineHeight: 1,
  },
  metaRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  metaPill: {
    fontSize: 9,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 10,
    background: '#f1f5f9',
    color: '#475569',
  },
  responseText: {
    fontSize: 12,
    color: '#374151',
    lineHeight: 1.65,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#6366f1',
    fontSize: 11,
    cursor: 'pointer',
    padding: '2px 0',
    textAlign: 'left' as const,
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
}
