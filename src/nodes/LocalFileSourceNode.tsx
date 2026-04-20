/**
 * LocalFileSourceNode — source node that reads a single CSV or TSV file
 * selected via a standard <input type="file"> element.
 *
 * Supports delimiter auto-detection (by extension and content sniffing),
 * optional header row, and auto-casting of numeric strings to numbers
 * (useful for geographic coordinates stored as text).
 *
 * No runner registered — file selection requires a direct user gesture.
 */

import { useRef, useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

// ── Node data ─────────────────────────────────────────────────────────────────

export interface LocalFileSourceNodeData {
  delimiter: 'auto' | ',' | '\t' | ';' | '|'
  hasHeader: boolean
  autoCast: boolean
  fileName: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  statusMessage: string
  count: number
  columnNames: string[]
  resultsVersion?: number
  [key: string]: unknown
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#0e7490'
const BTN_COLOR    = '#0891b2'

const DELIMITER_OPTIONS = [
  { value: 'auto', label: 'Auto-detect' },
  { value: ',',    label: 'Comma (CSV)' },
  { value: '\t',   label: 'Tab (TSV)' },
  { value: ';',    label: 'Semicolon' },
  { value: '|',    label: 'Pipe' },
]

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  ready:   '#22c55e',
  error:   '#ef4444',
}

// ── CSV/TSV parser ────────────────────────────────────────────────────────────

function detectDelimiter(firstLine: string, fileName: string): string {
  if (fileName.endsWith('.tsv')) return '\t'
  const counts = {
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ',':  (firstLine.match(/,/g)  ?? []).length,
    ';':  (firstLine.match(/;/g)  ?? []).length,
    '|':  (firstLine.match(/\|/g) ?? []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      result.push(field); field = ''
    } else {
      field += ch
    }
  }
  result.push(field)
  return result
}

function parseDelimited(
  text: string,
  delimiterSetting: string,
  hasHeader: boolean,
  autoCast: boolean,
  fileName: string,
): { records: Record<string, unknown>[]; columns: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { records: [], columns: [] }

  const delim = delimiterSetting === 'auto'
    ? detectDelimiter(lines[0], fileName)
    : delimiterSetting

  const rawHeaders = hasHeader
    ? splitLine(lines[0], delim).map(h => h.trim())
    : splitLine(lines[0], delim).map((_, i) => `col${i + 1}`)

  const dataLines = hasHeader ? lines.slice(1) : lines
  const colCount  = rawHeaders.length

  const records = dataLines.map(line => {
    const values = splitLine(line, delim)
    const record: Record<string, unknown> = {}
    for (let i = 0; i < colCount; i++) {
      const raw = (values[i] ?? '').trim()
      if (autoCast && raw !== '' && !isNaN(Number(raw))) {
        record[rawHeaders[i]] = Number(raw)
      } else {
        record[rawHeaders[i]] = raw
      }
    }
    return record
  })

  return { records, columns: rawHeaders }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LocalFileSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as LocalFileSourceNodeData
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    clearNodeResults(id)
    updateNodeData(id, {
      status: 'loading',
      statusMessage: 'Parsing…',
      fileName: file.name,
      count: 0,
      columnNames: [],
    })

    try {
      const text = await file.text()
      const { records, columns } = parseDelimited(
        text,
        d.delimiter ?? 'auto',
        d.hasHeader ?? true,
        d.autoCast  ?? true,
        file.name,
      )

      const version = setNodeResults(id, records)
      updateNodeData(id, {
        status:         'ready',
        statusMessage:  `✓ ${records.length} rows`,
        fileName:       file.name,
        count:          records.length,
        columnNames:    columns,
        resultsVersion: version,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, {
        status:        'error',
        statusMessage: `✗ ${msg}`,
        count:         0,
        columnNames:   [],
      })
    }

    // Reset so the same file can be re-picked after config changes
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [id, updateNodeData, d.delimiter, d.hasHeader, d.autoCast])

  const handlePickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // Re-parse the last file with updated settings (not possible — no file handle retained).
  // The user must re-pick; we just surface settings changes visually.

  const status      = (d.status      as string   | undefined) ?? 'idle'
  const fileName    = (d.fileName    as string   | undefined) ?? ''
  const count       = (d.count       as number   | undefined) ?? 0
  const columnNames = (d.columnNames as string[] | undefined) ?? []
  const delimiter   = (d.delimiter   as string   | undefined) ?? 'auto'
  const hasHeader   = (d.hasHeader   as boolean  | undefined) ?? true
  const autoCast    = (d.autoCast    as boolean  | undefined) ?? true
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Local File (CSV/TSV)</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* Delimiter */}
        <div style={styles.row}>
          <span style={styles.label}>Delimiter</span>
          <select
            style={styles.select}
            value={delimiter}
            onChange={e => updateNodeData(id, { delimiter: e.target.value })}
            className="nodrag"
          >
            {DELIMITER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Header row */}
        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={hasHeader}
            onChange={e => updateNodeData(id, { hasHeader: e.target.checked })}
            style={{ marginRight: 4 }}
          />
          First row is header
        </label>

        {/* Auto-cast */}
        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={autoCast}
            onChange={e => updateNodeData(id, { autoCast: e.target.checked })}
            style={{ marginRight: 4 }}
          />
          Cast numeric strings to numbers
        </label>

        {/* File info */}
        {fileName ? (
          <div style={styles.fileInfo}>
            <span style={styles.fileIcon}>📄</span>
            <span style={styles.fileName} title={fileName}>{fileName}</span>
            {count > 0 && <span style={styles.countBadge}>{count} rows</span>}
          </div>
        ) : null}

        {/* Column preview */}
        {columnNames.length > 0 && (
          <div style={styles.colPreview}>
            <span style={styles.colPreviewLabel}>Columns: </span>
            <span style={styles.colPreviewNames}>
              {columnNames.slice(0, 8).join(', ')}
              {columnNames.length > 8 ? ` +${columnNames.length - 8} more` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={{
            ...styles.btn,
            background: BTN_COLOR,
            opacity: status === 'loading' ? 0.6 : 1,
          }}
          onClick={handlePickFile}
          disabled={status === 'loading'}
          className="nodrag"
        >
          {status === 'loading' ? 'Parsing…' : '📂 Pick File'}
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt"
        style={{ display: 'none' }}
        onChange={handleFileChange}
        className="nodrag"
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="data"
        style={styles.outputHandle}
      />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 240,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: 32,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerTitle: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
    flexShrink: 0,
  },
  headerStatus: {
    fontSize: 10,
    fontWeight: 600,
    color: '#a5f3fc',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  body: {
    padding: '10px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 7,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    width: 60,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    flex: 1,
    height: 22,
    background: '#fff',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    padding: '4px 6px',
    background: '#ecfeff',
    borderRadius: 4,
    border: '1px solid #a5f3fc',
  },
  fileIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  fileName: {
    fontSize: 11,
    fontWeight: 600,
    color: '#0e7490',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#0891b2',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    flexShrink: 0,
  },
  colPreview: {
    fontSize: 10,
    color: '#6b7280',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  },
  colPreviewLabel: {
    fontWeight: 700,
    color: '#374151',
  },
  colPreviewNames: {
    fontFamily: 'monospace',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 12px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  outputHandle: {
    width: 10,
    height: 10,
    background: '#0891b2',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #0891b2',
  },
}
