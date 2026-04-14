/**
 * LocalFolderSourceNode — source node that reads files from a user-selected
 * local folder via the File System Access API.
 *
 * Emits FileRecord[] on the output handle so downstream nodes (OllamaNode,
 * TableOutputNode, etc.) can read them via data.results.
 *
 * No upstream runner is registered for this node — folder selection requires
 * a direct user gesture and the results are pre-populated before any workflow
 * run.
 */

import { useState, useCallback, useRef } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { scanDirectory, TYPE_LABEL_MAP, type FileRecord } from '../utils/fileReaders'

// ── Node data (persisted in React Flow node state) ────────────────────────────

export interface LocalFolderSourceNodeData {
  fileTypes: string[]
  maxFiles: number
  folderName: string
  status: 'idle' | 'scanning' | 'ready' | 'error'
  statusMessage: string
  results: FileRecord[] | undefined
  count: number
  [key: string]: unknown
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#14532d'
const BTN_COLOR    = '#15803d'

const FILE_TYPE_OPTIONS = [
  { key: 'pdf',   label: 'PDF' },
  { key: 'xml',   label: 'XML / TEI' },
  { key: 'text',  label: 'Text' },
  { key: 'image', label: 'Images' },
]

const STATUS_BORDER: Record<string, string> = {
  idle:     '#d1d5db',
  scanning: '#3b82f6',
  ready:    '#22c55e',
  error:    '#ef4444',
}

const HAS_API = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ── Component ─────────────────────────────────────────────────────────────────

export function LocalFolderSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as LocalFolderSourceNodeData

  // dirHandle is internal state — not serialisable into node data
  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [scanSummary, setScanSummary] = useState<string>('')

  const doScan = useCallback(async (handle: FileSystemDirectoryHandle) => {
    const fileTypes = (d.fileTypes as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
    const maxFiles  = Number(d.maxFiles) || 50

    updateNodeData(id, {
      status:        'scanning',
      statusMessage: 'Scanning…',
      folderName:    handle.name,
      results:       undefined,
      count:         0,
    })
    setScanSummary('')

    try {
      const { files, totalFound, skipped } = await scanDirectory(handle, fileTypes, maxFiles)

      // Build summary string like "12 files: 8 PDF, 3 XML, 1 image"
      const typeCounts: Record<string, number> = {}
      for (const f of files) {
        typeCounts[f.contentType] = (typeCounts[f.contentType] ?? 0) + 1
      }
      const typeStr = Object.entries(typeCounts)
        .map(([t, n]) => `${n} ${t.replace('pdf_text', 'PDF').replace('xml', 'XML')}`)
        .join(', ')
      const summary = `${files.length} file${files.length !== 1 ? 's' : ''}${typeStr ? `: ${typeStr}` : ''}${skipped ? ` (${skipped} skipped)` : ''}`

      setScanSummary(summary)
      console.log(`[LocalFolder] scanned ${handle.name}: found ${totalFound}, loaded ${files.length}, skipped ${skipped}`)

      updateNodeData(id, {
        status:        'ready',
        statusMessage: `✓ ${files.length} files`,
        folderName:    handle.name,
        results:       files,
        count:         files.length,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LocalFolder] scan error', msg)
      updateNodeData(id, {
        status:        'error',
        statusMessage: `✗ ${msg}`,
        results:       undefined,
        count:         0,
      })
    }
  }, [id, updateNodeData, d.fileTypes, d.maxFiles])

  const handlePickFolder = useCallback(async () => {
    if (!HAS_API) return
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>
      }).showDirectoryPicker()
      dirHandleRef.current = handle
      await doScan(handle)
    } catch (err) {
      // AbortError = user cancelled — reset to idle silently
      if ((err as { name?: string }).name === 'AbortError') {
        updateNodeData(id, { status: 'idle', statusMessage: '' })
        return
      }
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, doScan])

  const handleRescan = useCallback(async () => {
    if (!dirHandleRef.current) return
    await doScan(dirHandleRef.current)
  }, [doScan])

  const toggleType = useCallback((key: string) => {
    const current = (d.fileTypes as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
    const next = current.includes(key)
      ? current.filter(k => k !== key)
      : [...current, key]
    updateNodeData(id, { fileTypes: next })
  }, [id, updateNodeData, d.fileTypes])

  const status      = (d.status as string | undefined) ?? 'idle'
  const folderName  = (d.folderName as string | undefined) ?? ''
  const fileTypes   = (d.fileTypes as string[] | undefined) ?? Object.keys(TYPE_LABEL_MAP)
  const maxFiles    = Number(d.maxFiles) || 50
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'
  const count       = (d.count as number | undefined) ?? 0

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Local Folder</span>
        {d.statusMessage ? (
          <span style={{
            fontSize: 10, fontWeight: 600, color: '#86efac',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {!HAS_API ? (
          <div style={styles.noApiWarning}>
            Requires Chrome or Edge 86+
          </div>
        ) : (
          <>
            {/* File type checkboxes */}
            <div style={styles.sectionLabel}>File types</div>
            <div style={styles.checkboxRow}>
              {FILE_TYPE_OPTIONS.map(opt => (
                <label key={opt.key} style={styles.checkLabel} className="nodrag">
                  <input
                    type="checkbox"
                    checked={fileTypes.includes(opt.key)}
                    onChange={() => toggleType(opt.key)}
                    style={{ marginRight: 3 }}
                  />
                  {opt.label}
                </label>
              ))}
            </div>

            {/* Max files */}
            <div style={styles.row}>
              <span style={styles.paramLabel}>Max files</span>
              <input
                type="number"
                style={{ ...styles.inlineInput, width: 60 }}
                value={maxFiles}
                min={1}
                max={500}
                onChange={e => updateNodeData(id, { maxFiles: parseInt(e.target.value, 10) || 50 })}
                className="nodrag"
              />
            </div>

            {/* Folder info (after selection) */}
            {folderName ? (
              <div style={styles.folderInfo}>
                <span style={styles.folderIcon}>📁</span>
                <span style={styles.folderName} title={folderName}>{folderName}</span>
                {count > 0 && (
                  <span style={styles.countBadge}>{count}</span>
                )}
              </div>
            ) : null}

            {/* Scan summary */}
            {scanSummary ? (
              <div style={styles.scanSummary}>{scanSummary}</div>
            ) : null}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {HAS_API && dirHandleRef.current && status !== 'scanning' && (
          <button
            style={{ ...styles.btn, background: '#374151', marginRight: 6 }}
            onClick={handleRescan}
            className="nodrag"
          >
            ↺ Re-scan
          </button>
        )}
        {HAS_API && (
          <button
            style={{
              ...styles.btn,
              background: BTN_COLOR,
              opacity: status === 'scanning' ? 0.6 : 1,
            }}
            onClick={handlePickFolder}
            disabled={status === 'scanning'}
            className="nodrag"
          >
            {status === 'scanning' ? 'Scanning…' : '📂 Pick Folder'}
          </button>
        )}
      </div>

      {/* Right output handle */}
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
  body: {
    padding: '10px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: '#6b7280',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  checkboxRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  paramLabel: {
    fontSize: 11,
    color: '#6b7280',
    width: 56,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  inlineInput: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  folderInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    padding: '4px 6px',
    background: '#f0fdf4',
    borderRadius: 4,
    border: '1px solid #bbf7d0',
  },
  folderIcon: {
    fontSize: 12,
    flexShrink: 0,
  },
  folderName: {
    fontSize: 11,
    fontWeight: 600,
    color: '#166534',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: '#16a34a',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    flexShrink: 0,
  },
  scanSummary: {
    fontSize: 10,
    color: '#6b7280',
    fontStyle: 'italic' as const,
    lineHeight: 1.4,
  },
  noApiWarning: {
    fontSize: 11,
    color: '#ef4444',
    padding: '6px 0',
    textAlign: 'center' as const,
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
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
    background: '#22c55e',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
