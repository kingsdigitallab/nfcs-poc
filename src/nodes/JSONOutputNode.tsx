import { useState } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'

export interface JSONOutputNodeData {
  [key: string]: unknown
}

/**
 * Lightweight syntax highlighting — no external dependency.
 * Escapes HTML, then wraps JSON token types in <span class="json-*">.
 * CSS rules live in index.css.
 */
function highlight(json: string): string {
  const escaped = json
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped.replace(
    /("(\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    match => {
      let cls = 'json-number'
      if (match.startsWith('"')) {
        cls = match.trimEnd().endsWith(':') ? 'json-key' : 'json-string'
      } else if (match === 'true' || match === 'false') {
        cls = 'json-bool'
      } else if (match === 'null') {
        cls = 'json-null'
      }
      return `<span class="${cls}">${match}</span>`
    },
  )
}

const PREVIEW_RECORDS = 5

export function JSONOutputNode({ id }: NodeProps) {
  const { records, count, status, connected } = useUpstreamRecords(id)
  const [showAll, setShowAll] = useState(false)

  const displayed = records
    ? showAll
      ? records
      : records.slice(0, PREVIEW_RECORDS)
    : undefined

  const json = displayed ? JSON.stringify(displayed, null, 2) : null

  return (
    <div style={styles.card}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      <div style={styles.header}>
        <span style={styles.title}>JSON Output</span>
        {connected && records && (
          <span style={styles.badge}>
            {showAll ? records.length : Math.min(PREVIEW_RECORDS, records.length)} / {count.toLocaleString()} records
          </span>
        )}
        {connected && status === 'loading' && (
          <span style={{ ...styles.badge, color: '#c4b5fd' }}>loading…</span>
        )}
      </div>

      {!connected && (
        <div style={styles.placeholder}>Connect a search node to the input handle</div>
      )}

      {connected && !records && status !== 'loading' && (
        <div style={styles.placeholder}>Run the upstream node to see results</div>
      )}

      {connected && records && (
        <>
          <div style={styles.toolbar} className="nodrag">
            {records.length > PREVIEW_RECORDS && (
              <button
                style={styles.toggleBtn}
                onClick={() => setShowAll(v => !v)}
                className="nodrag"
              >
                {showAll ? `▲ Show first ${PREVIEW_RECORDS}` : `▼ Show all ${records.length}`}
              </button>
            )}
            {records.length <= PREVIEW_RECORDS && (
              <span style={{ fontSize: 10, color: '#9ca3af' }}>
                {records.length} record{records.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div style={styles.preWrap} className="nodrag nowheel">
            <pre
              style={styles.pre}
              // Safe: highlight() only produces span tags around escaped content
              // eslint-disable-next-line react/no-danger
              dangerouslySetInnerHTML={{ __html: highlight(json ?? '[]') }}
            />
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  card: {
    background: '#1e1e2e',
    border: '1.5px solid #3b3b5c',
    borderRadius: 8,
    minWidth: 380,
    maxWidth: 560,
    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
    overflow: 'hidden',
  },
  header: {
    background: '#6d28d9',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
  },
  badge: {
    color: '#ddd6fe',
    fontSize: 10,
    fontWeight: 600,
  },
  placeholder: {
    padding: '20px 16px',
    color: '#6b7280',
    fontSize: 12,
    fontStyle: 'italic' as const,
    textAlign: 'center' as const,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    background: '#16162a',
    borderBottom: '1px solid #2a2a45',
  },
  toggleBtn: {
    background: 'transparent',
    border: '1px solid #3b3b5c',
    color: '#a78bfa',
    borderRadius: 4,
    padding: '2px 8px',
    fontSize: 11,
    cursor: 'pointer',
  },
  preWrap: {
    overflowY: 'auto' as const,
    maxHeight: 320,
  },
  pre: {
    margin: 0,
    padding: '10px 12px',
    fontSize: 11,
    lineHeight: 1.6,
    fontFamily: "'Consolas', 'Menlo', monospace",
    color: '#cdd6f4',
    whiteSpace: 'pre' as const,
    overflowX: 'auto' as const,
  },
  inputHandle: {
    width: 10,
    height: 10,
    background: '#6d28d9',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #6d28d9',
  },
}
