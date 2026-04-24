/**
 * LoadSavedSearchNode — source node that reads a .nfcs.json file (saved by
 * SaveSearchNode) or any raw UnifiedRecord[] JSON array (exported via ExportNode).
 *
 * When the file contains an _nfcs envelope the full metadata is displayed:
 * saved date, source breakdown, record count, and the original search params
 * in a collapsible section. Metadata is persisted in node data so the
 * workflow file documents the provenance even when records need to be reloaded.
 *
 * No runner — file loading requires a direct user gesture.
 */
import { useRef, useCallback } from 'react'
import { Handle, Position, NodeProps, useReactFlow } from '@xyflow/react'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { isNfcsSavedSearch } from '../types/savedSearch'
import type { NfcsSavedSearchMeta } from '../types/savedSearch'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export interface LoadSavedSearchNodeData {
  status: 'idle' | 'loading' | 'ready' | 'error'
  statusMessage: string
  // Metadata persisted from the _nfcs envelope (survives workflow save/reload)
  savedAt: string
  sources: string[]
  sourceCounts: Record<string, number>
  recordCount: number
  searchParams: Record<string, Record<string, unknown>>
  hasEnvelope: boolean
  // Runtime (stripped by TRANSIENT_FIELDS on workflow save)
  count: number
  resultsVersion: number
  [key: string]: unknown
}

const HEADER_COLOR = '#4c1d95'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  ready:   '#22c55e',
  error:   '#ef4444',
}

// ── Param display helpers ─────────────────────────────────────────────────────

const NODE_TYPE_LABELS: Record<string, string> = {
  gbifSearch:        'GBIF Search',
  lldsSearch:        'LLDS Search',
  adsSearchAdvanced: 'ADS Data Catalogue',
  adsLibrarySearch:  'ADS Library',
  mdsSearch:         'Museum Data Service',
  localFileSource:   'Local CSV File',
  localFolderSource: 'Local Folder',
}

function labelForKey(key: string): string {
  const type = key.split('::')[0]
  return NODE_TYPE_LABELS[type] ?? type
}

/** Strip inline prefix and lowercase first char: inlineQ → q */
function formatParamKey(k: string): string {
  if (k.startsWith('inline') && k.length > 6) {
    return k[6].toLowerCase() + k.slice(7)
  }
  return k
}

/** Return only params with meaningful values */
function meaningfulParams(
  params: Record<string, unknown>,
): [string, string][] {
  return Object.entries(params).flatMap(([k, v]) => {
    if (v === '' || v === null || v === undefined || v === false) return []
    if (Array.isArray(v) && v.length === 0) return []
    const display = Array.isArray(v) ? v.join(', ') : String(v)
    return [[formatParamKey(k), display]]
  })
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
  } catch {
    return iso
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function LoadSavedSearchNode({ id, data }: NodeProps) {
  const d = data as LoadSavedSearchNodeData
  const { updateNodeData } = useReactFlow()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = '' // reset so same file can be re-loaded

      clearNodeResults(id)
      updateNodeData(id, { status: 'loading', statusMessage: 'Reading…' })

      const reader = new FileReader()
      reader.onload = ev => {
        try {
          const raw: unknown = JSON.parse(ev.target?.result as string)

          let records: UnifiedRecord[]
          let meta: Partial<NfcsSavedSearchMeta> = {}
          let hasEnvelope = false

          if (isNfcsSavedSearch(raw)) {
            records    = raw.records
            meta       = raw._nfcs
            hasEnvelope = true
          } else if (Array.isArray(raw)) {
            records = raw as UnifiedRecord[]
          } else {
            throw new Error('File is not a recognised NFCS saved search or UnifiedRecord array.')
          }

          if (records.length === 0) {
            throw new Error('File contains no records.')
          }

          const version = setNodeResults(id, records as unknown as Record<string, unknown>[])

          updateNodeData(id, {
            status:         'ready',
            statusMessage:  `✓ ${records.length} records`,
            count:          records.length,
            resultsVersion: version,
            hasEnvelope,
            savedAt:        meta.savedAt        ?? '',
            sources:        meta.sources        ?? [],
            sourceCounts:   meta.sourceCounts   ?? {},
            recordCount:    meta.recordCount    ?? records.length,
            searchParams:   meta.searchParams   ?? {},
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          updateNodeData(id, {
            status:        'error',
            statusMessage: `✗ ${msg}`,
            count:         0,
          })
        }
      }
      reader.readAsText(file)
    },
    [id, updateNodeData],
  )

  const status      = (d.status as string | undefined) ?? 'idle'
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'
  const hasEnvelope = d.hasEnvelope as boolean | undefined
  const savedAt     = d.savedAt as string | undefined
  const sources     = (d.sources as string[] | undefined) ?? []
  const sourceCounts = (d.sourceCounts as Record<string, number> | undefined) ?? {}
  const searchParams = (d.searchParams as Record<string, Record<string, unknown>> | undefined) ?? {}
  const recordCount  = d.recordCount as number | undefined
  const count        = (d.count as number | undefined) ?? 0

  // After workflow reload, metadata shows but count is 0 — records need reloading
  const needsReload = (hasEnvelope || savedAt) && count === 0 && status === 'idle'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Load Saved Search</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus} title={d.statusMessage as string}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      {/* Body */}
      <div style={styles.body}>

        {/* Metadata panel — shown when envelope data is available */}
        {hasEnvelope && savedAt ? (
          <div style={styles.metaPanel}>
            {/* Saved date */}
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>saved</span>
              <span style={styles.metaVal}>{fmtDate(savedAt)}</span>
            </div>

            {/* Source breakdown */}
            {sources.length > 0 && (
              <div style={styles.metaRow}>
                <span style={styles.metaKey}>sources</span>
                <span style={styles.sourceChips}>
                  {sources.map(s => (
                    <span key={s} style={styles.chip}>
                      {s}&nbsp;<span style={styles.chipCount}>{sourceCounts[s] ?? ''}</span>
                    </span>
                  ))}
                </span>
              </div>
            )}

            {/* Record count */}
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>records</span>
              <span style={styles.metaVal}>
                {count > 0
                  ? <span style={styles.countLoaded}>{count} loaded</span>
                  : <span style={styles.countStale}>{recordCount} (not loaded)</span>
                }
              </span>
            </div>

            {/* Search params — collapsible */}
            {Object.keys(searchParams).length > 0 && (
              <details style={styles.details}>
                <summary style={styles.summary}>Search parameters</summary>
                <div style={styles.paramsBody}>
                  {Object.entries(searchParams).map(([key, params]) => {
                    const pairs = meaningfulParams(params)
                    if (pairs.length === 0) return null
                    return (
                      <div key={key} style={styles.paramGroup}>
                        <div style={styles.paramGroupLabel}>{labelForKey(key)}</div>
                        {pairs.map(([k, v]) => (
                          <div key={k} style={styles.paramRow}>
                            <span style={styles.paramKey}>{k}</span>
                            <span style={styles.paramVal} title={v}>{v}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </div>
        ) : !hasEnvelope && count > 0 ? (
          // Raw array (no envelope) — minimal info
          <div style={styles.rawNote}>
            <span style={styles.countLoaded}>{count} records</span>
            <span style={styles.rawLabel}> — no metadata (raw export)</span>
          </div>
        ) : (
          <p style={styles.hint}>Load a .nfcs.json saved search file</p>
        )}

        {/* Re-load nudge after workflow reload */}
        {needsReload && (
          <p style={styles.reloadNote}>
            Records cleared on workflow reload — click Load File to restore.
          </p>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button
          style={{
            ...styles.btn,
            opacity: status === 'loading' ? 0.6 : 1,
          }}
          disabled={status === 'loading'}
          onClick={() => fileInputRef.current?.click()}
          className="nodrag"
        >
          {status === 'loading' ? 'Loading…' : '📂  Load File'}
        </button>
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
    background:   '#fff',
    border:       '2px solid #d1d5db',
    borderRadius: 8,
    minWidth:     260,
    maxWidth:     320,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
    transition:   'border-color 0.2s',
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
    fontSize:     10,
    fontWeight:   600,
    color:        '#ddd6fe',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  body: {
    padding:       '10px 12px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
  },
  hint: {
    margin:    0,
    fontSize:  11,
    color:     '#9ca3af',
    fontStyle: 'italic' as const,
  },
  metaPanel: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           4,
    padding:       '6px 8px',
    background:    '#faf5ff',
    border:        '1px solid #e9d5ff',
    borderRadius:  5,
  },
  metaRow: {
    display:    'flex',
    alignItems: 'flex-start',
    gap:        6,
  },
  metaKey: {
    fontSize:   9,
    fontWeight: 700,
    color:      '#7c3aed',
    fontFamily: 'monospace',
    width:      46,
    flexShrink: 0,
    paddingTop: 1,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  metaVal: {
    fontSize: 10,
    color:    '#374151',
    flex:     1,
  },
  sourceChips: {
    display:  'flex',
    flexWrap: 'wrap' as const,
    gap:      3,
    flex:     1,
  },
  chip: {
    fontSize:     9,
    fontWeight:   600,
    background:   '#ede9fe',
    color:        '#5b21b6',
    border:       '1px solid #c4b5fd',
    borderRadius: 8,
    padding:      '1px 5px',
  },
  chipCount: {
    opacity: 0.7,
  },
  countLoaded: {
    fontSize:     10,
    fontWeight:   700,
    color:        '#059669',
  },
  countStale: {
    fontSize:  10,
    color:     '#9ca3af',
    fontStyle: 'italic' as const,
  },
  details: {
    marginTop: 2,
  },
  summary: {
    fontSize:  10,
    fontWeight: 600,
    color:     '#6d28d9',
    cursor:    'pointer',
    userSelect: 'none' as const,
    listStyle: 'none',
    display:   'flex',
    alignItems: 'center',
    gap:       4,
  },
  paramsBody: {
    marginTop:     4,
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           5,
  },
  paramGroup: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           2,
  },
  paramGroupLabel: {
    fontSize:   9,
    fontWeight: 700,
    color:      '#7c3aed',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 1,
  },
  paramRow: {
    display:    'flex',
    gap:        5,
    alignItems: 'baseline',
  },
  paramKey: {
    fontSize:   9,
    color:      '#9ca3af',
    fontFamily: 'monospace',
    flexShrink: 0,
    minWidth:   60,
  },
  paramVal: {
    fontSize:     10,
    color:        '#1f2937',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
    flex:         1,
  },
  rawNote: {
    fontSize: 10,
    color:    '#374151',
  },
  rawLabel: {
    color:     '#9ca3af',
    fontStyle: 'italic' as const,
  },
  reloadNote: {
    margin:    0,
    fontSize:  9,
    color:     '#d97706',
    fontStyle: 'italic' as const,
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  outputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
}
