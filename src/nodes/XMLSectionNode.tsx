/**
 * XMLSectionNode — interrogates XML/TEI records via XPath, analogous to
 * HTMLSectionNode for HTML content.
 *
 * Reads upstream records that have a `content` field containing XML text
 * (e.g. from LocalFolderSourceNode xml handle or LocalFileSourceNode xml mode),
 * evaluates the XPath expression, and writes the result to `xmlContent`.
 * Records without `content` are passed through unchanged.
 */

import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { runXMLSectionNode } from '../utils/runXMLSectionNode'
import { useEdges } from '@xyflow/react'

// ── Node data ─────────────────────────────────────────────────────────────────

export interface XMLSectionNodeData {
  xpath: string
  outputMode: 'text' | 'xml'
  maxLength: number
  status: 'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  inputCount: number
  outputCount: number
  resultsVersion?: number
  [key: string]: unknown
}

// ── Schema inspector ──────────────────────────────────────────────────────────

function buildSchema(xmlText: string): string[] {
  try {
    const stripped = xmlText.replace(/\sxmlns="[^"]*"/g, '')
    const parser = new DOMParser()
    const doc    = parser.parseFromString(stripped, 'application/xml')
    if (doc.querySelector('parsererror')) return []

    const paths = new Set<string>()
    function walk(el: Element, prefix: string) {
      const path = prefix ? `${prefix}/${el.localName}` : `//${el.localName}`
      paths.add(path)
      for (const child of el.children) walk(child, path)
    }
    walk(doc.documentElement, '')
    return [...paths].slice(0, 30)
  } catch {
    return []
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#44403c'
const BTN_COLOR    = '#57534e'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function XMLSectionNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes } = useReactFlow()
  const allEdges = useEdges()
  const d = data as XMLSectionNodeData

  const upstream = useUpstreamRecords(id)
  const [schemaLines, setSchemaLines] = useState<string[]>([])
  const [showSchema, setShowSchema] = useState(false)
  const [preview, setPreview] = useState<string>('')

  const xpath      = (d.xpath      as string  | undefined) ?? ''
  const outputMode = (d.outputMode as string  | undefined) ?? 'text'
  const maxLength  = (d.maxLength  as number  | undefined) ?? 8000
  const status     = (d.status     as string  | undefined) ?? 'idle'
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const inspectSchema = useCallback(() => {
    const recs = upstream.records
    const xmlText = recs?.find(r => typeof r.content === 'string')?.content as string | undefined
    if (!xmlText) { setSchemaLines(['No XML content found upstream']); setShowSchema(true); return }
    const lines = buildSchema(xmlText)
    setSchemaLines(lines.length > 0 ? lines : ['Could not parse XML'])
    setShowSchema(true)
  }, [upstream.records])

  const previewXPath = useCallback(() => {
    const recs = upstream.records
    const xmlText = recs?.find(r => typeof r.content === 'string')?.content as string | undefined
    if (!xmlText || !xpath.trim()) { setPreview('No content or XPath'); return }
    try {
      const stripped = xmlText.replace(/\sxmlns="[^"]*"/g, '')
      const doc      = new DOMParser().parseFromString(stripped, 'application/xml')
      if (doc.querySelector('parsererror')) { setPreview('XML parse error'); return }
      if (outputMode === 'text') {
        const r = document.evaluate(xpath, doc, null, XPathResult.STRING_TYPE, null)
        const val = (r.stringValue ?? '').replace(/\s+/g, ' ').trim()
        setPreview(val.slice(0, 500) || '(empty)')
      } else {
        const snap = document.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        const ser  = new XMLSerializer()
        const parts: string[] = []
        for (let i = 0; i < snap.snapshotLength; i++) {
          const n = snap.snapshotItem(i)
          if (n) parts.push(ser.serializeToString(n))
        }
        setPreview(parts.join('\n').slice(0, 500) || '(no matches)')
      }
    } catch (err) {
      setPreview(`Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [upstream.records, xpath, outputMode])

  const handleRun = useCallback(async () => {
    await runXMLSectionNode(
      id,
      getNodes,
      allEdges,
      (nid, patch) => updateNodeData(nid, patch as Record<string, unknown>),
    )
  }, [id, getNodes, allEdges, updateNodeData])

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>XML Section</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* XPath input */}
        <div style={styles.row}>
          <span style={styles.label}>XPath</span>
          <input
            type="text"
            style={styles.textInput}
            value={xpath}
            placeholder="e.g. //tei:text"
            onChange={e => updateNodeData(id, { xpath: e.target.value })}
            className="nodrag"
          />
        </div>

        {/* Output mode */}
        <div style={styles.row}>
          <span style={styles.label}>Output</span>
          <div style={styles.toggleGroup}>
            {(['text', 'xml'] as const).map(m => (
              <button
                key={m}
                style={{
                  ...styles.toggleBtn,
                  background: outputMode === m ? BTN_COLOR : '#f3f4f6',
                  color:      outputMode === m ? '#fff'    : '#374151',
                }}
                onClick={() => updateNodeData(id, { outputMode: m })}
                className="nodrag"
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Max length */}
        <div style={styles.row}>
          <span style={styles.label}>Max chars</span>
          <input
            type="number"
            style={{ ...styles.textInput, width: 80 }}
            value={maxLength}
            min={100}
            step={1000}
            onChange={e => updateNodeData(id, { maxLength: parseInt(e.target.value, 10) || 8000 })}
            className="nodrag"
          />
        </div>

        {/* Upstream summary */}
        {upstream.connected && (
          <div style={styles.upstreamInfo}>
            {upstream.records ? `${upstream.records.length} upstream records` : 'No records yet'}
          </div>
        )}

        {/* Schema inspector */}
        <div style={styles.actionRow}>
          <button style={styles.actionBtn} onClick={inspectSchema} className="nodrag">
            Inspect schema
          </button>
          <button style={styles.actionBtn} onClick={previewXPath} className="nodrag">
            Preview
          </button>
        </div>

        {/* Schema lines */}
        {showSchema && schemaLines.length > 0 && (
          <div style={styles.schemaBox}>
            <div style={styles.schemaHeader}>
              <span>Element paths</span>
              <button
                style={styles.schemaClose}
                onClick={() => setShowSchema(false)}
                className="nodrag"
              >✕</button>
            </div>
            {schemaLines.map((line, i) => (
              <div
                key={i}
                style={styles.schemaLine}
                onClick={() => {
                  updateNodeData(id, { xpath: line })
                  setShowSchema(false)
                }}
                className="nodrag"
                title="Click to use as XPath"
              >
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Preview box */}
        {preview && (
          <div style={styles.previewBox}>
            <div style={styles.previewLabel}>Preview</div>
            <pre style={styles.previewText}>{preview}</pre>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {d.outputCount != null && (d.outputCount as number) > 0 && (
          <span style={styles.countChip}>
            {d.outputCount as number} records
          </span>
        )}
        <button
          style={{
            ...styles.runBtn,
            opacity: status === 'running' || !upstream.connected ? 0.6 : 1,
          }}
          onClick={handleRun}
          disabled={status === 'running' || !upstream.connected}
          className="nodrag"
        >
          {status === 'running' ? 'Running…' : 'Run'}
        </button>
      </div>

      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={styles.inputHandle}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="results"
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
    minWidth: 260,
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
    color: '#d6d3d1',
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
  textInput: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    flex: 1,
    height: 22,
    fontFamily: 'monospace',
  },
  toggleGroup: {
    display: 'flex',
    gap: 2,
    flex: 1,
  },
  toggleBtn: {
    flex: 1,
    border: '1px solid #d1d5db',
    borderRadius: 4,
    padding: '2px 0',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  upstreamInfo: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic' as const,
  },
  actionRow: {
    display: 'flex',
    gap: 6,
  },
  actionBtn: {
    flex: 1,
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    padding: '3px 0',
    fontSize: 10,
    fontWeight: 600,
    color: '#374151',
    cursor: 'pointer',
  },
  schemaBox: {
    background: '#fafaf9',
    border: '1px solid #e7e5e4',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: 'monospace',
    maxHeight: 140,
    overflowY: 'auto' as const,
  },
  schemaHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 6px',
    borderBottom: '1px solid #e7e5e4',
    fontSize: 9,
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  schemaClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 10,
    color: '#9ca3af',
    padding: 0,
  },
  schemaLine: {
    padding: '2px 6px',
    color: '#44403c',
    cursor: 'pointer',
    lineHeight: 1.6,
  },
  previewBox: {
    background: '#fafaf9',
    border: '1px solid #e7e5e4',
    borderRadius: 4,
    padding: '4px 6px',
  },
  previewLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    marginBottom: 2,
  },
  previewText: {
    fontSize: 10,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
    maxHeight: 100,
    overflowY: 'auto' as const,
    color: '#292524',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  countChip: {
    fontSize: 10,
    color: '#6b7280',
    fontStyle: 'italic' as const,
  },
  runBtn: {
    background: BTN_COLOR,
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 14px',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inputHandle: {
    width: 10,
    height: 10,
    background: '#78716c',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #78716c',
  },
  outputHandle: {
    width: 10,
    height: 10,
    background: '#44403c',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #44403c',
  },
}
