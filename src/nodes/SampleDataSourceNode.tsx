/**
 * SampleDataSourceNode — source node that loads pre-packaged collection files
 * from public/fixtures/ over HTTP.
 *
 * Reads a curated collections-manifest.json, lets the user select a named
 * package (e.g. "Stonehenge") and tick individual files within it, then fetches
 * and extracts them as FileRecord[]. Emits results through the same 5 typed
 * output handles as LocalFolderSourceNode so every downstream node works
 * unchanged.
 *
 * Unlike LocalFolderSourceNode this node has a real runner (no user gesture
 * required) and participates in Run All and saved example workflows.
 *
 * Easter egg: includes a dummy input handle (left side) — unused, exists to
 * illustrate the data-retrieval gap in example workflows (metadata easy, actual
 * datasets hard).
 *
 * Output handles (right side, same fixed positions as LocalFolderSourceNode):
 *   results — all file records
 *   pdf     — PDF text records only
 *   xml     — XML/TEI records only
 *   text    — plain-text records only
 *   image   — image records only
 */

import { useState, useEffect, useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { loadSampleFiles, type SelectedFile } from '../utils/runSampleDataNode'

// ── Manifest types ─────────────────────────────────────────────────────────────

interface ManifestFile {
  label:     string
  type:      'xml' | 'text' | 'pdf' | 'image' | 'csv'
  filename:  string
  sizeBytes?: number
  url:       string
}

interface ManifestItem {
  label: string
  files: ManifestFile[]
}

interface ManifestPackage {
  slug:        string
  title:       string
  service:     string
  description: string
  items:       ManifestItem[]
}

interface CollectionsManifest {
  packages: ManifestPackage[]
}

// ── Node data ──────────────────────────────────────────────────────────────────

export interface SampleDataSourceNodeData {
  selectedPackage: string
  packageTitle:    string
  selectedFiles:   SelectedFile[]
  status:          'idle' | 'loading' | 'ready' | 'error'
  statusMessage:   string
  count:           number
  pdfCount:        number
  xmlCount:        number
  textCount:       number
  imageCount:      number
  csvCount:        number
  resultsVersion?: number
  [key: string]:   unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#1e3a5f'
const BTN_COLOR    = '#1d4ed8'

// Must exactly match LocalFolderSourceNode — handle top positions are computed
// from header height (32) + body padding-top (8) + outputs label (18) + row height (24):
// results: 32+8+18+12=70, pdf: +24=94, xml: +24=118, text: +24=142, image: +24=166
const OUTPUT_HANDLES = [
  { id: 'results', label: 'All',   color: '#6b7280', top: 70  },
  { id: 'pdf',     label: 'PDF',   color: '#dc2626', top: 94  },
  { id: 'xml',     label: 'XML',   color: '#d97706', top: 118 },
  { id: 'text',    label: 'Text',  color: '#16a34a', top: 142 },
  { id: 'image',   label: 'Image', color: '#2563eb', top: 166 },
  { id: 'csv',     label: 'CSV',   color: '#0d9488', top: 190 },
]

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  ready:   '#22c55e',
  error:   '#ef4444',
}

const TYPE_COLOR: Record<string, string> = {
  xml:   '#d97706',
  text:  '#16a34a',
  pdf:   '#dc2626',
  image: '#2563eb',
  csv:   '#0d9488',
}

// ── Manifest fetch (module-level cache) ────────────────────────────────────────

let _manifestPromise: Promise<CollectionsManifest> | null = null

function fetchManifest(): Promise<CollectionsManifest> {
  if (!_manifestPromise) {
    _manifestPromise = fetch('/fixtures/collections-manifest.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<CollectionsManifest>
      })
      .catch(err => {
        _manifestPromise = null   // allow retry on next render
        throw err
      })
  }
  return _manifestPromise
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`
  if (n >= 1_000)     return `${Math.round(n / 1_000)} KB`
  return `${n} B`
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SampleDataSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as SampleDataSourceNodeData

  const [manifest,     setManifest]     = useState<CollectionsManifest | null>(null)
  const [manifestErr,  setManifestErr]  = useState<string | null>(null)

  // Load manifest once on mount
  useEffect(() => {
    fetchManifest()
      .then(m => setManifest(m))
      .catch(e => setManifestErr(String(e)))
  }, [])

  const selectedPackage = (d.selectedPackage as string   | undefined) ?? ''
  const packageTitle    = (d.packageTitle    as string   | undefined) ?? ''
  const selectedFiles   = (d.selectedFiles   as SelectedFile[] | undefined) ?? []
  const status          = (d.status          as string   | undefined) ?? 'idle'
  const count           = (d.count           as number   | undefined) ?? 0
  const pdfCount        = (d.pdfCount        as number   | undefined) ?? 0
  const xmlCount        = (d.xmlCount        as number   | undefined) ?? 0
  const textCount       = (d.textCount       as number   | undefined) ?? 0
  const imageCount      = (d.imageCount      as number   | undefined) ?? 0
  const csvCount        = (d.csvCount        as number   | undefined) ?? 0

  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const currentPkg = manifest?.packages.find(p => p.slug === selectedPackage) ?? null

  const typedCounts: Record<string, number> = {
    results: count,
    pdf:     pdfCount,
    xml:     xmlCount,
    text:    textCount,
    image:   imageCount,
    csv:     csvCount,
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handlePackageChange = useCallback((slug: string) => {
    const pkg = manifest?.packages.find(p => p.slug === slug)
    updateNodeData(id, {
      selectedPackage: slug,
      packageTitle:    pkg?.title ?? '',
      selectedFiles:   [],
      status:          'idle',
      statusMessage:   '',
      count:           0,
      pdfCount:        0,
      xmlCount:        0,
      textCount:       0,
      imageCount:      0,
      csvCount:        0,
      resultsVersion:  0,
    })
  }, [id, manifest, updateNodeData])

  const handleToggleFile = useCallback((file: ManifestFile) => {
    const current = (data.selectedFiles as SelectedFile[] | undefined) ?? []
    const exists  = current.some(f => f.url === file.url)
    const next: SelectedFile[] = exists
      ? current.filter(f => f.url !== file.url)
      : [...current, { url: file.url, filename: file.filename, label: file.label, type: file.type }]
    updateNodeData(id, { selectedFiles: next })
  }, [id, data.selectedFiles, updateNodeData])

  const handleLoad = useCallback(async () => {
    if (status === 'loading' || selectedFiles.length === 0) return
    await loadSampleFiles(id, selectedFiles, packageTitle, updateNodeData)
  }, [id, selectedFiles, packageTitle, status, updateNodeData])

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Dummy input — easter egg to illustrate data-gap concept */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{
          width:     10,
          height:    10,
          background: '#cbd5e1',
          border:    '2px solid #fff',
          boxShadow: '0 0 0 1px #cbd5e1',
        }}
        title="Unused input (data-gap illustration)"
      />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Sample Data</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>
        {/* ── Outputs section (FIRST — keeps handle positions deterministic) ── */}
        <div style={styles.outputsSection}>
          <div style={styles.outputsSectionLabel}>Outputs</div>
          {OUTPUT_HANDLES.map(h => (
            <div key={h.id} style={styles.outputRow}>
              <span style={{ ...styles.outputLabel, color: h.color }}>{h.label}</span>
              {typedCounts[h.id] > 0 && (
                <span style={{ ...styles.outputBadge, background: h.color }}>
                  {typedCounts[h.id]}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Manifest loading states */}
        {manifestErr && (
          <div style={styles.errorMsg}>⚠ Failed to load catalogue: {manifestErr}</div>
        )}
        {!manifest && !manifestErr && (
          <div style={styles.hintText}>Loading catalogue…</div>
        )}

        {/* Package selector */}
        {manifest && (
          <>
            <div style={styles.row}>
              <span style={styles.paramLabel}>Package</span>
              <select
                style={styles.select}
                value={selectedPackage}
                onChange={e => handlePackageChange(e.target.value)}
                className="nodrag"
              >
                <option value="">— choose —</option>
                {manifest.packages.map(p => (
                  <option key={p.slug} value={p.slug}>{p.title}</option>
                ))}
              </select>
            </div>

            {/* Package description */}
            {currentPkg && (
              <div style={styles.pkgDesc}>{currentPkg.description}</div>
            )}

            {/* File tree */}
            {currentPkg && (
              <div style={styles.fileTree}>
                {currentPkg.items.map((item, ii) => (
                  <div key={ii} style={styles.itemBlock}>
                    <div style={styles.itemLabel} title={item.label}>{item.label}</div>
                    {item.files.map((file, fi) => {
                      const checked = selectedFiles.some(f => f.url === file.url)
                      return (
                        <label key={fi} style={styles.fileRow} className="nodrag">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleFile(file)}
                            style={{ marginRight: 5, flexShrink: 0 }}
                            className="nodrag"
                          />
                          <span style={styles.fileLabel}>{file.label}</span>
                          <span style={{ ...styles.typeBadge, background: TYPE_COLOR[file.type] ?? '#6b7280' }}>
                            {file.type}
                          </span>
                          {file.sizeBytes != null && (
                            <span style={styles.sizeLabel}>{fmtBytes(file.sizeBytes)}</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

            {/* Selection summary */}
            {selectedFiles.length > 0 && (
              <div style={styles.selSummary}>
                {selectedFiles.length} file{selectedFiles.length !== 1 ? 's' : ''} selected
                <button
                  style={styles.clearBtn}
                  onClick={() => updateNodeData(id, { selectedFiles: [] })}
                  className="nodrag"
                >
                  ×
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          style={{
            ...styles.btn,
            background: BTN_COLOR,
            opacity: (status === 'loading' || selectedFiles.length === 0) ? 0.5 : 1,
            cursor:  (status === 'loading' || selectedFiles.length === 0) ? 'not-allowed' : 'pointer',
          }}
          onClick={handleLoad}
          disabled={status === 'loading' || selectedFiles.length === 0}
          className="nodrag"
        >
          {status === 'loading' ? 'Loading…' : '📥 Load Selected'}
        </button>
      </div>

      {/* Right output handles — identical positions to LocalFolderSourceNode */}
      {OUTPUT_HANDLES.map(h => (
        <Handle
          key={h.id}
          type="source"
          position={Position.Right}
          id={h.id}
          style={{
            top:       h.top,
            width:     10,
            height:    10,
            background: h.color,
            border:    '2px solid #fff',
            boxShadow: `0 0 0 1px ${h.color}`,
          }}
          title={h.label}
        />
      ))}
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:     260,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
    transition:   'border-color 0.25s',
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
  headerStatus: {
    fontSize:      10,
    fontWeight:    600,
    color:         '#93c5fd',
    overflow:      'hidden',
    textOverflow:  'ellipsis',
    whiteSpace:    'nowrap' as const,
  },
  body: {
    padding:       '8px 12px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
  },
  // Outputs section — MUST be first in body; height locks handle positions
  outputsSection: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           0,
    marginBottom:  4,
    paddingRight:  16,
  },
  outputsSectionLabel: {
    fontSize:      10,
    fontWeight:    700,
    color:         '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    height:        18,
    display:       'flex',
    alignItems:    'center',
  },
  outputRow: {
    height:         24,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            6,
  },
  outputLabel: {
    fontSize:   11,
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  outputBadge: {
    fontSize:     10,
    fontWeight:   700,
    color:        '#fff',
    borderRadius: 10,
    padding:      '1px 6px',
    flexShrink:   0,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  paramLabel: {
    fontSize:   11,
    color:      '#6b7280',
    width:      54,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    fontSize:   11,
    padding:    '2px 4px',
    border:     '1px solid #d1d5db',
    borderRadius: 4,
    outline:    'none',
    flex:       1,
    height:     22,
    background: '#fff',
  },
  pkgDesc: {
    fontSize:    10,
    color:       '#6b7280',
    fontStyle:   'italic' as const,
    lineHeight:  1.4,
  },
  fileTree: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
    marginTop:     2,
  },
  itemBlock: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           2,
  },
  itemLabel: {
    fontSize:      10,
    fontWeight:    700,
    color:         '#374151',
    overflow:      'hidden',
    textOverflow:  'ellipsis',
    whiteSpace:    'nowrap' as const,
    paddingBottom: 1,
    borderBottom:  '1px solid #e5e7eb',
    marginBottom:  2,
  },
  fileRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    padding:    '2px 4px 2px 8px',
    borderRadius: 3,
    cursor:     'pointer',
    userSelect: 'none' as const,
    fontSize:   11,
  },
  fileLabel: {
    color:        '#374151',
    flex:         1,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  typeBadge: {
    fontSize:     9,
    fontWeight:   700,
    color:        '#fff',
    borderRadius: 3,
    padding:      '1px 4px',
    flexShrink:   0,
  },
  sizeLabel: {
    fontSize:   9,
    color:      '#9ca3af',
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  selSummary: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    fontSize:       10,
    fontWeight:     600,
    color:          '#1d4ed8',
    background:     '#eff6ff',
    borderRadius:   4,
    padding:        '3px 6px',
    border:         '1px solid #bfdbfe',
  },
  clearBtn: {
    background:   'none',
    border:       'none',
    color:        '#6b7280',
    cursor:       'pointer',
    fontSize:     13,
    lineHeight:   1,
    padding:      '0 2px',
    fontWeight:   700,
  },
  hintText: {
    fontSize:    10,
    color:       '#9ca3af',
    fontStyle:   'italic' as const,
    paddingTop:  2,
  },
  errorMsg: {
    fontSize:    10,
    color:       '#ef4444',
    lineHeight:  1.4,
  },
  footer: {
    padding:        '4px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 12px',
    fontSize:     11,
    fontWeight:   600,
  },
}
