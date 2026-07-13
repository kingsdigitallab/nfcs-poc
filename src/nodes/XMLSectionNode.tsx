/**
 * XMLSectionNode — interrogates XML/TEI records via XPath.
 *
 * Reads upstream records with a `content` field containing XML text,
 * evaluates the XPath expression, and writes the result to `xmlContent`.
 * Records without `content` are passed through unchanged.
 *
 * Schema inspector: builds a proper collapsible tree by deduplicating
 * children at each level (so `teiHeader` and `text` both appear as siblings
 * under the root, not buried after 30 header paths). Depth-limited to 10
 * rather than path-count-limited, so the tree always covers the full document.
 *
 * Preview: navigates across multiple upstream XML records.
 */

import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps, NodeResizer, useEdges } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { runXMLSectionNode } from '../utils/runXMLSectionNode'

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

// ── Schema tree types ─────────────────────────────────────────────────────────

interface XmlSchemaNode {
  tag:      string
  xpath:    string      // //tag — click-to-insert suggestion
  path:     string      // full path from root e.g. /TEI/text/body
  count:    number      // sibling count (>1 means repeated element)
  hasText:  boolean     // has direct text node content
  attrs:    string[]    // first 3 attribute names
  children: XmlSchemaNode[]
}

// ── Schema tree builder ────────────────────────────────────────────────────────
//
// Deduplicates children at each level: only one representative per unique tag
// name is kept, with a `count` reflecting how many siblings share that name.
// This means <teiHeader> and <text> both appear under the root regardless of
// depth — no DFS path-count cutoff can hide a sibling.

function buildXmlSchema(xmlText: string): XmlSchemaNode | null {
  try {
    const stripped = xmlText.replace(/\s+xmlns(?::\w+)?="[^"]*"/g, '')
    const doc = new DOMParser().parseFromString(stripped, 'application/xml')
    if (doc.querySelector('parsererror')) return null

    function walk(el: Element, path: string, depth: number): XmlSchemaNode {
      // Deduplicate children by localName; keep first representative + count
      const seen = new Map<string, { el: Element; count: number }>()
      for (const child of el.children) {
        const t = child.localName
        if (seen.has(t)) seen.get(t)!.count++
        else seen.set(t, { el: child, count: 1 })
      }

      const children: XmlSchemaNode[] =
        depth < 10
          ? [...seen.values()].map(({ el: c, count }) => {
              const n  = walk(c, `${path}/${c.localName}`, depth + 1)
              n.count  = count
              return n
            })
          : []

      const hasText = Array.from(el.childNodes).some(
        n => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length ?? 0) > 0,
      )

      return {
        tag:      el.localName,
        xpath:    `//${el.localName}`,
        path,
        count:    1,
        hasText,
        attrs:    Array.from(el.attributes).map(a => a.name).slice(0, 3),
        children,
      }
    }

    return walk(doc.documentElement, `/${doc.documentElement.localName}`, 0)
  } catch {
    return null
  }
}

// ── Schema tree view component ─────────────────────────────────────────────────

function SchemaTreeView({
  root,
  onSelect,
}: {
  root:     XmlSchemaNode
  onSelect: (xpath: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([root.path, ...root.children.map(c => c.path)]),
  )

  function toggle(path: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  function renderNode(node: XmlSchemaNode, depth: number): React.ReactNode {
    const hasChildren = node.children.length > 0
    const isExpanded  = expanded.has(node.path)

    return (
      <div key={node.path}>
        <div
          style={{
            display:     'flex',
            alignItems:  'center',
            paddingLeft: depth * 11 + 2,
            minHeight:   20,
            gap:         3,
          }}
        >
          <span
            style={{
              width:      12,
              flexShrink: 0,
              cursor:     hasChildren ? 'pointer' : 'default',
              color:      '#b0a891',
              fontSize:   9,
              userSelect: 'none',
            }}
            onClick={() => hasChildren && toggle(node.path)}
          >
            {hasChildren ? (isExpanded ? '▾' : '▸') : '·'}
          </span>

          <span
            style={{
              color:      '#0f172a',
              fontFamily: 'monospace',
              fontSize:   10,
              cursor:     'pointer',
              flexShrink: 0,
            }}
            onClick={() => onSelect(node.xpath)}
            title={`Insert XPath: ${node.xpath}`}
          >
            &lt;{node.tag}&gt;
          </span>

          {node.count > 1 && (
            <span style={treeStyles.countBadge}>×{node.count}</span>
          )}
          {node.hasText && (
            <span style={treeStyles.textBadge}>text</span>
          )}
          {node.attrs.map(a => (
            <span key={a} style={treeStyles.attrBadge}>@{a}</span>
          ))}
        </div>

        {isExpanded && node.children.map(c => renderNode(c, depth + 1))}
      </div>
    )
  }

  return <div style={{ userSelect: 'none' }}>{renderNode(root, 0)}</div>
}

const treeStyles = {
  countBadge: {
    fontSize: 9, color: '#8a8168',
    background: '#f3f4f6', borderRadius: 3, padding: '0 3px',
  },
  textBadge: {
    fontSize: 9, color: '#8a8168', fontStyle: 'italic' as const,
  },
  attrBadge: {
    fontSize: 9, color: '#92400e',
    background: '#fef3c7', borderRadius: 3, padding: '0 3px',
  },
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#4a4640'
const BTN_COLOR    = '#57534e'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d6ccb5',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function XMLSectionNode({ id, data, selected }: NodeProps) {
  const { updateNodeData, getNodes } = useReactFlow()
  const allEdges = useEdges()
  const d = data as XMLSectionNodeData

  const upstream = useUpstreamRecords(id)

  const [schemaRoot,  setSchemaRoot]  = useState<XmlSchemaNode | null>(null)
  const [showSchema,  setShowSchema]  = useState(false)
  const [preview,     setPreview]     = useState<string>('')
  const [recIdx,      setRecIdx]      = useState(0)

  const xpath      = (d.xpath      as string | undefined) ?? ''
  const outputMode = (d.outputMode as string | undefined) ?? 'text'
  const maxLength  = (d.maxLength  as number | undefined) ?? 8000
  const status     = (d.status     as string | undefined) ?? 'idle'
  const borderColor = STATUS_BORDER[status] ?? '#d6ccb5'

  // All upstream records that have XML content
  const xmlRecords = (upstream.records ?? []).filter(r => typeof r.content === 'string')
  const safeIdx    = Math.min(recIdx, Math.max(0, xmlRecords.length - 1))
  const xmlText    = (xmlRecords[safeIdx]?.content as string | undefined)

  const inspectSchema = useCallback(() => {
    if (!xmlText) {
      setSchemaRoot(null)
      setShowSchema(true)
      return
    }
    const root = buildXmlSchema(xmlText)
    setSchemaRoot(root)
    setShowSchema(true)
  }, [xmlText])

  const previewXPath = useCallback(() => {
    if (!xmlText || !xpath.trim()) { setPreview('No content or XPath'); return }
    try {
      const stripped = xmlText.replace(/\s+xmlns(?::\w+)?="[^"]*"/g, '')
      const doc      = new DOMParser().parseFromString(stripped, 'application/xml')
      if (doc.querySelector('parsererror')) { setPreview('XML parse error'); return }
      if (outputMode === 'text') {
        const r   = doc.evaluate(xpath, doc, null, XPathResult.STRING_TYPE, null)
        const val = (r.stringValue ?? '').replace(/\s+/g, ' ').trim()
        setPreview(val.slice(0, 500) || '(empty)')
      } else {
        const snap  = doc.evaluate(xpath, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null)
        const ser   = new XMLSerializer()
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
  }, [xmlText, xpath, outputMode])

  const handleRun = useCallback(async () => {
    await runXMLSectionNode(
      id,
      getNodes,
      allEdges,
      (nid, patch) => updateNodeData(nid, patch as Record<string, unknown>),
    )
  }, [id, getNodes, allEdges, updateNodeData])

  const handleRecNav = (delta: number) => {
    const next = Math.max(0, Math.min(xmlRecords.length - 1, safeIdx + delta))
    setRecIdx(next)
    setShowSchema(false)
    setPreview('')
  }

  return (
    <>
    <NodeResizer
      minWidth={260} minHeight={200}
      isVisible={selected}
      lineStyle={{ borderColor: HEADER_COLOR }}
      handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
    />
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
            placeholder="e.g. //body//p"
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
                  color:      outputMode === m ? '#fff'    : '#33302a',
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
            {xmlRecords.length > 0
              ? `${xmlRecords.length} XML record${xmlRecords.length !== 1 ? 's' : ''} upstream`
              : upstream.records
              ? `${upstream.records.length} records upstream (no XML content found)`
              : 'No records yet'}
          </div>
        )}

        {/* Record navigation (only when multiple XML records are present) */}
        {xmlRecords.length > 1 && (
          <div style={styles.recNav}>
            <button
              style={{ ...styles.recNavBtn, opacity: safeIdx === 0 ? 0.4 : 1 }}
              disabled={safeIdx === 0}
              onClick={() => handleRecNav(-1)}
              className="nodrag"
            >◀</button>
            <span style={styles.recNavLabel}>
              Record {safeIdx + 1} of {xmlRecords.length}
            </span>
            <button
              style={{ ...styles.recNavBtn, opacity: safeIdx >= xmlRecords.length - 1 ? 0.4 : 1 }}
              disabled={safeIdx >= xmlRecords.length - 1}
              onClick={() => handleRecNav(1)}
              className="nodrag"
            >▶</button>
          </div>
        )}

        {/* Action buttons */}
        <div style={styles.actionRow}>
          <button style={styles.actionBtn} onClick={inspectSchema} className="nodrag">
            Inspect schema
          </button>
          <button style={styles.actionBtn} onClick={previewXPath} className="nodrag">
            Preview
          </button>
        </div>

        {/* Schema tree */}
        {showSchema && (
          <div style={styles.schemaBox}>
            <div style={styles.schemaHeader}>
              <span>
                Element tree
                {xmlRecords.length > 1 && (
                  <span style={{ marginLeft: 6, fontWeight: 400, color: '#b0a891' }}>
                    (record {safeIdx + 1})
                  </span>
                )}
              </span>
              <button
                style={styles.schemaClose}
                onClick={() => setShowSchema(false)}
                className="nodrag"
              >✕</button>
            </div>
            <div style={{ padding: '4px 2px 4px 4px' }}>
              {schemaRoot
                ? (
                  <SchemaTreeView
                    key={safeIdx}
                    root={schemaRoot}
                    onSelect={x => { updateNodeData(id, { xpath: x }); setShowSchema(false) }}
                  />
                )
                : <div style={{ fontSize: 10, color: '#8a8168', padding: '4px 6px' }}>
                    {xmlText ? 'Could not parse XML' : 'No XML content found upstream'}
                  </div>
              }
            </div>
          </div>
        )}

        {/* Preview box */}
        {preview && (
          <div style={styles.previewBox}>
            <div style={styles.previewLabel}>
              Preview
              {xmlRecords.length > 1 && (
                <span style={{ marginLeft: 6, fontWeight: 400, color: '#b0a891' }}>
                  (record {safeIdx + 1})
                </span>
              )}
            </div>
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
      <Handle type="target" position={Position.Left}  id="data"    style={styles.inputHandle}  />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
    </>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fffdf7',
    border: '2px solid #d6ccb5',
    borderRadius: 8,
    width: '100%',
    height: '100%',
    minWidth: 260,
    minHeight: 200,
    boxShadow: '0 1px 4px rgba(50,42,26,0.10)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxSizing: 'border-box' as const,
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
    flex: 1,
    overflowY: 'auto' as const,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 11,
    color: '#8a8168',
    width: 60,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  textInput: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d6ccb5',
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
    border: '1px solid #d6ccb5',
    borderRadius: 4,
    padding: '2px 0',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'monospace',
  },
  upstreamInfo: {
    fontSize: 10,
    color: '#b0a891',
    fontStyle: 'italic' as const,
  },
  recNav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  recNavBtn: {
    background: '#f3f4f6',
    border: '1px solid #d6ccb5',
    borderRadius: 3,
    padding: '1px 7px',
    fontSize: 10,
    cursor: 'pointer',
    color: '#33302a',
  },
  recNavLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: '#33302a',
    minWidth: 90,
    textAlign: 'center' as const,
  },
  actionRow: {
    display: 'flex',
    gap: 6,
  },
  actionBtn: {
    flex: 1,
    background: '#f3f4f6',
    border: '1px solid #d6ccb5',
    borderRadius: 4,
    padding: '3px 0',
    fontSize: 10,
    fontWeight: 600,
    color: '#33302a',
    cursor: 'pointer',
  },
  schemaBox: {
    background: '#fafaf9',
    border: '1px solid #e7e5e4',
    borderRadius: 4,
    fontSize: 10,
    fontFamily: 'monospace',
    maxHeight: 240,
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
    color: '#8a8168',
    textTransform: 'uppercase' as const,
    position: 'sticky' as const,
    top: 0,
    background: '#fafaf9',
  },
  schemaClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 10,
    color: '#b0a891',
    padding: 0,
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
    color: '#b0a891',
    textTransform: 'uppercase' as const,
    marginBottom: 2,
  },
  previewText: {
    fontSize: 10,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    margin: 0,
    maxHeight: 120,
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
    color: '#8a8168',
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
