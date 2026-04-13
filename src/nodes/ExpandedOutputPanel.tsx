/**
 * ExpandedOutputPanel — rendered as a child of <ReactFlow> using the RF <Panel>
 * component, which means it has access to all RF context hooks.
 *
 * Triggered by double-clicking a TableOutputNode or JSONOutputNode.
 * Shows the full dataset: paginated table or complete JSON.
 */
import { useState, useMemo } from 'react'
import { Panel, useNodes, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { ReconciliationResult } from '../utils/reconciliationService'
import { isReconciledValue } from '../utils/reconciliationService'
import { renderCell }        from './ReconciledCell'
import type { UnifiedRecord } from '../types/UnifiedRecord'

interface Props {
  nodeId: string
  onClose: () => void
}

const DEFAULT_COLS = [
  '_source', 'title', 'creator', 'date', 'country',
  'subject', 'language', 'scientificName', 'basisOfRecord', 'institutionCode',
] as const

const PAGE_SIZE = 25

function allFlatColumns(records: UnifiedRecord[]): string[] {
  const keys = new Set<string>()
  for (const r of records) {
    for (const [k, v] of Object.entries(r)) {
      if (v === null) continue
      if (typeof v !== 'object' || Array.isArray(v) || isReconciledValue(v)) keys.add(k)
    }
  }
  const ordered = DEFAULT_COLS.filter(c => keys.has(c))
  const extras = [...keys]
    .filter(k => !(DEFAULT_COLS as readonly string[]).includes(k))
    .sort()
  return [...ordered, ...extras]
}


function highlight(json: string): string {
  return json
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      m => {
        let cls = 'json-number'
        if (m.startsWith('"')) cls = m.trimEnd().endsWith(':') ? 'json-key' : 'json-string'
        else if (m === 'true' || m === 'false') cls = 'json-bool'
        else if (m === 'null') cls = 'json-null'
        return `<span class="${cls}">${m}</span>`
      },
    )
}

export function ExpandedOutputPanel({ nodeId, onClose }: Props) {
  const allNodes = useNodes()
  const { updateNodeData } = useReactFlow()
  const node = allNodes.find(n => n.id === nodeId)
  const { records, count } = useUpstreamRecords(nodeId)
  const [page, setPage] = useState(0)
  const [showAll, setShowAll] = useState(false)

  if (!node) return null
  const isTable = node.type === 'tableOutput'
  const accentColor = isTable ? '#0d9488' : '#6d28d9'

  // Read user-overridden selections from the table node's own data (shared with TableOutputNode)
  const selections = ((node.data as Record<string, unknown>).selections ?? {}) as Record<string, ReconciliationResult>

  // Apply selections to upstream records (same logic as TableOutputNode)
  const effectiveRecords = useMemo<UnifiedRecord[] | null>(() => {
    if (!records) return null
    if (Object.keys(selections).length === 0) return records
    return records.map(rec => {
      const patch: Record<string, unknown> = {}
      for (const [key, result] of Object.entries(selections)) {
        const sep = key.indexOf('::')
        if (sep === -1) continue
        const recId = key.slice(0, sep)
        const col   = key.slice(sep + 2)
        if (rec.id === recId) patch[col] = result
      }
      return Object.keys(patch).length > 0 ? { ...rec, ...patch } as UnifiedRecord : rec
    })
  }, [records, selections])

  // Write selections back to the table node's data so TableOutputNode stays in sync
  function handleSelectCandidate(recordId: string, col: string, result: ReconciliationResult) {
    updateNodeData(nodeId, {
      selections: { ...selections, [`${recordId}::${col}`]: result },
    })
  }

  const displayRecords = isTable ? effectiveRecords : records
  const columns = displayRecords
    ? showAll ? allFlatColumns(displayRecords) : DEFAULT_COLS.filter(c => displayRecords.some(r => r[c] != null))
    : []
  const totalPages = displayRecords ? Math.ceil(displayRecords.length / PAGE_SIZE) : 0
  const pageRows = displayRecords ? displayRecords.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : []

  return (
    <Panel
      position="top-right"
      style={{
        width: 'min(820px, 55vw)',
        maxHeight: 'calc(100vh - 120px)',
        background: isTable ? '#fff' : '#1e1e2e',
        border: `2px solid ${accentColor}`,
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        margin: 10,
      }}
    >
      {/* Header */}
      <div style={{
        background: accentColor,
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
          {isTable ? 'Table Output' : 'JSON Output'} — expanded
        </span>
        {displayRecords && (
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11 }}>
            {displayRecords.length} fetched / {count.toLocaleString()} total
          </span>
        )}
        {isTable && Object.keys(selections).length > 0 && (
          <span style={{ color: '#fde68a', fontSize: 11, fontWeight: 600 }}>
            {Object.keys(selections).length} override{Object.keys(selections).length !== 1 ? 's' : ''}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: 'none',
            color: '#fff',
            borderRadius: 4,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ✕
        </button>
      </div>

      {/* No data */}
      {!displayRecords && (
        <div style={{ padding: 24, color: '#9ca3af', textAlign: 'center', fontSize: 13 }}>
          Run the upstream node to see results
        </div>
      )}

      {/* Table view */}
      {displayRecords && isTable && (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '6px 14px', borderBottom: '1px solid #e5e7eb',
            background: '#f9fafb', flexShrink: 0,
          }}>
            <label style={{ fontSize: 12, color: '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showAll} onChange={e => { setShowAll(e.target.checked); setPage(0) }} />
              {' '}show all columns
            </label>
            <span style={{ fontSize: 11, color: '#9ca3af' }}>{columns.length} cols</span>
          </div>

          <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th key={col} style={panelTh}>{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((rec, i) => (
                  <tr key={rec.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    {columns.map(col => {
                      const val = rec[col as keyof UnifiedRecord]
                      const handleSelect = (result: ReconciliationResult) =>
                        handleSelectCandidate(rec.id, col, result)
                      return (
                        <td key={col} style={panelTd}>
                          {renderCell(val, handleSelect)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 12, padding: '6px 14px', borderTop: '1px solid #e5e7eb',
              background: '#f9fafb', flexShrink: 0,
            }}>
              <button style={pageBtnStyle} disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Page {page + 1} of {totalPages}</span>
              <button style={pageBtnStyle} disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}

      {/* JSON view */}
      {displayRecords && !isTable && (
        <div style={{ overflow: 'auto', flex: 1 }}>
          <pre
            style={{
              margin: 0, padding: '12px 16px',
              fontSize: 12, lineHeight: 1.6,
              fontFamily: "'Consolas', 'Menlo', monospace",
              color: '#cdd6f4',
              whiteSpace: 'pre',
            }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: highlight(JSON.stringify(displayRecords, null, 2)) }}
          />
        </div>
      )}
    </Panel>
  )
}

const panelTh: React.CSSProperties = {
  background: '#f3f4f6',
  borderBottom: '2px solid #e5e7eb',
  padding: '5px 10px',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

const panelTd: React.CSSProperties = {
  borderBottom: '1px solid #f0f0f0',
  padding: '5px 10px',
  color: '#4b5563',
  maxWidth: 200,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const pageBtnStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '3px 10px',
  fontSize: 12,
  cursor: 'pointer',
}
