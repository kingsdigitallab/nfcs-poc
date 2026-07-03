/**
 * BackboneSearchNode — shared shell for ARIADNE-backbone search services
 * (ARIADNE portal, HSDS). The two node components were ~82% identical; the
 * whole chrome lives here once and each service supplies a declarative
 * config (title, theme colours, facet option lists, sort options).
 *
 * HANDLE CONTRACT — do not change: input handles `query` (row 0) and
 * `limit` (row 1) at handleTop(rowIndex), output handle `results` on the
 * right. Edges in saved .nfcs.json workflows reference these ids and the
 * top offsets are load-bearing (CLAUDE.md gotcha 16 class of bug).
 *
 * The Run button dispatches through the nodeRunners registry (NOT a direct
 * runner import), so the ▶ Run path honours the withFixture wrapper and
 * the 📦 fixture toggle exactly like Run All does.
 */
import { useState, useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'

export type BackboneStatus = 'idle' | 'loading' | 'success' | 'error'

export interface BackboneTheme {
  /** Header bar + filter-toggle text + filter-count badge background */
  header: string
  /** Run button background */
  runBtn: string
  /** Filter toggle background */
  accentBg: string
  /** Filter toggle + filter section border */
  accentBorder: string
  /** Filter section background */
  sectionBg: string
  /** "Clear all filters" text */
  clearBtn: string
  /** 📦 icon colour when fixture mode is on */
  fixtureIcon: string
}

export interface BackboneSearchConfig {
  /** Node type string — nodeRunners registry key AND fixture filename prefix */
  nodeType: string
  /** Header label, e.g. 'ARIADNE Search' */
  title: string
  theme: BackboneTheme
  sortOptions: { value: string; label: string }[]
  resourceTypeOptions: string[]
  dataTypeOptions: string[]
  countryOptions: string[]
  temporalOptions: string[]
  contributorOptions: string[]
  derivedSubjectSuggestions: string[]
  nativeSubjectSuggestions: string[]
  derivedPlaceholder: string
  nativePlaceholder: string
}

// ── Layout (shared by every backbone node — handle offsets depend on these) ──

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'e.g. Stonehenge', rowIndex: 0 },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20',              rowIndex: 1 },
] as const

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

const STATUS_BORDER: Record<BackboneStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

const STATUS_BADGE: Record<BackboneStatus, string> = {
  idle:    '#9ca3af',
  loading: '#93c5fd',
  success: '#86efac',
  error:   '#fca5a5',
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BackboneSearchNode({ id, data, config }: NodeProps & { config: BackboneSearchConfig }) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as Record<string, unknown>
  const [filtersOpen, setFiltersOpen] = useState(false)

  const styles      = stylesFor(config.theme)
  const fetchAll    = (d.fetchAll as boolean | undefined) ?? false
  const status      = d.status as BackboneStatus
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => nodeRunners[config.nodeType](id, getNodes, getEdgesSnap(), updateNodeData),
    [id, updateNodeData, getNodes, getEdgesSnap],  // config is module-constant per node type
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    updateNodeData(id, { [key]: e.target.value })

  const activeFilterCount = [
    d.ariadneSubject, d.derivedSubject, d.nativeSubject,
    d.country, d.dataType, d.temporal, d.contributor,
  ].filter(Boolean).length

  return (
    <div style={{ ...styles.card, borderColor }}>
      {WIRABLE_ROWS.map(({ handleId, rowIndex }) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(rowIndex),
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      <div style={styles.header}>
        <span style={styles.headerTitle}>{config.title}</span>
        {d.statusMessage ? (
          <span style={{ ...styles.statusBadge, color: STATUS_BADGE[status] ?? '#9ca3af' }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      <div style={styles.body}>
        {WIRABLE_ROWS.map(({ handleId, dataKey, label, placeholder }) => {
          const isLimit   = handleId === 'limit'
          const disabled  = isLimit && fetchAll
          const connected = isConnected(handleId)
          return (
            <div key={handleId} style={styles.row}>
              <span style={styles.paramLabel}>{label}</span>
              {connected ? (
                <span style={styles.connectedBadge}>↔ wired</span>
              ) : disabled ? (
                <span style={styles.disabledHint}>all results</span>
              ) : (
                <input
                  style={styles.inlineInput}
                  value={(d[dataKey] as string | undefined) ?? ''}
                  onChange={e => updateNodeData(id, { [dataKey]: e.target.value })}
                  placeholder={placeholder}
                  className="nodrag"
                />
              )}
            </div>
          )
        })}

        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={fetchAll}
            onChange={e => updateNodeData(id, { fetchAll: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Fetch all results
        </label>

        <div style={styles.row}>
          <span style={styles.paramLabel}>sort</span>
          <select style={styles.select} value={(d.sort as string) || '_score'} onChange={set('sort')} className="nodrag">
            {config.sortOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select style={{ ...styles.select, width: 52 }} value={(d.order as string) || 'desc'} onChange={set('order')} className="nodrag">
            <option value="desc">↓</option>
            <option value="asc">↑</option>
          </select>
        </div>

        <button
          style={styles.filterToggle}
          onClick={() => setFiltersOpen(o => !o)}
          className="nodrag"
        >
          {filtersOpen ? '▾' : '▸'} Filters
          {activeFilterCount > 0 && (
            <span style={styles.filterBadge}>{activeFilterCount}</span>
          )}
        </button>

        {filtersOpen && (
          <div style={styles.filterSection}>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Resource type</span>
              <select style={styles.select} value={(d.ariadneSubject as string) || ''} onChange={set('ariadneSubject')} className="nodrag">
                {config.resourceTypeOptions.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Getty subject</span>
              <input
                list={`${id}-derived`}
                style={styles.inlineInput}
                value={(d.derivedSubject as string) || ''}
                onChange={set('derivedSubject')}
                placeholder={config.derivedPlaceholder}
                className="nodrag"
              />
              <datalist id={`${id}-derived`}>
                {config.derivedSubjectSuggestions.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Native subject</span>
              <input
                list={`${id}-native`}
                style={styles.inlineInput}
                value={(d.nativeSubject as string) || ''}
                onChange={set('nativeSubject')}
                placeholder={config.nativePlaceholder}
                className="nodrag"
              />
              <datalist id={`${id}-native`}>
                {config.nativeSubjectSuggestions.map(v => <option key={v} value={v} />)}
              </datalist>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Country</span>
              <select style={styles.select} value={(d.country as string) || ''} onChange={set('country')} className="nodrag">
                {config.countryOptions.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Data type</span>
              <select style={styles.select} value={(d.dataType as string) || ''} onChange={set('dataType')} className="nodrag">
                {config.dataTypeOptions.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Period</span>
              <select style={styles.select} value={(d.temporal as string) || ''} onChange={set('temporal')} className="nodrag">
                {config.temporalOptions.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            <div style={styles.filterRow}>
              <span style={styles.filterLabel}>Contributor</span>
              <select style={styles.select} value={(d.contributor as string) || ''} onChange={set('contributor')} className="nodrag">
                {config.contributorOptions.map(v => (
                  <option key={v} value={v}>{v || '— any —'}</option>
                ))}
              </select>
            </div>

            {activeFilterCount > 0 && (
              <button
                style={styles.clearBtn}
                onClick={() => updateNodeData(id, {
                  ariadneSubject: '', derivedSubject: '', nativeSubject: '',
                  country: '', dataType: '', temporal: '', contributor: '',
                })}
                className="nodrag"
              >
                ✕ Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <div style={styles.fixtureControls}>
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture from public/fixtures/ instead of live API">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? config.theme.fixtureIcon : '#9ca3af' }}>📦</span>
          </label>
          {(d.status === 'success' || d.status === 'cached') && (
            <button
              style={styles.fixtureSaveBtn} className="nodrag"
              title={`Download fixture: ${fixtureFilename(config.nodeType, resolveFixtureQuery(id, liveEdges, getNodes(), d))}`}
              onClick={() => downloadAsFixture(id, config.nodeType, resolveFixtureQuery(id, liveEdges, getNodes(), d))}
            >💾</button>
          )}
        </div>
        <button
          style={{ ...styles.runBtn, opacity: d.status === 'loading' ? 0.6 : 1 }}
          onClick={handleRun}
          disabled={d.status === 'loading'}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Running…' : d.useFixture ? '▶ Load fixture' : '▶  Run'}
        </button>
      </div>

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

const styleCache = new Map<BackboneTheme, ReturnType<typeof buildStyles>>()

function stylesFor(theme: BackboneTheme) {
  let s = styleCache.get(theme)
  if (!s) {
    s = buildStyles(theme)
    styleCache.set(theme, s)
  }
  return s
}

function buildStyles(theme: BackboneTheme) {
  return {
    card: {
      background: '#fff',
      border: '2px solid #d1d5db',
      borderRadius: 8,
      minWidth: 264,
      boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      position: 'relative' as const,
      transition: 'border-color 0.25s',
    },
    header: {
      height: HEADER_H,
      background: theme.header,
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
    statusBadge: {
      fontSize: 10,
      fontWeight: 600,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
    },
    body: {
      paddingTop: BODY_PAD,
      paddingLeft: 14,
      paddingRight: 10,
      paddingBottom: 4,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 5,
    },
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      height: ROW_H - 5,
    },
    paramLabel: {
      fontSize: 11,
      color: '#6b7280',
      width: 40,
      flexShrink: 0,
      fontFamily: 'monospace',
    },
    inlineInput: {
      flex: 1,
      fontSize: 11,
      padding: '2px 5px',
      border: '1px solid #d1d5db',
      borderRadius: 4,
      outline: 'none',
      minWidth: 0,
      height: 22,
    },
    select: {
      flex: 1,
      fontSize: 11,
      padding: '2px 4px',
      border: '1px solid #d1d5db',
      borderRadius: 4,
      outline: 'none',
      height: 22,
      background: '#fff',
      minWidth: 0,
    },
    connectedBadge: {
      fontSize: 10,
      color: '#3b82f6',
      fontStyle: 'italic' as const,
    },
    disabledHint: {
      fontSize: 10,
      color: '#9ca3af',
      fontStyle: 'italic' as const,
    },
    checkLabel: {
      display: 'flex',
      alignItems: 'center',
      fontSize: 11,
      color: '#374151',
      cursor: 'pointer',
      userSelect: 'none' as const,
      paddingTop: 2,
    },
    filterToggle: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 11,
      fontWeight: 600,
      color: theme.header,
      background: theme.accentBg,
      border: `1px solid ${theme.accentBorder}`,
      borderRadius: 4,
      padding: '3px 8px',
      cursor: 'pointer',
      marginTop: 2,
      width: '100%',
      textAlign: 'left' as const,
    },
    filterBadge: {
      fontSize: 10,
      fontWeight: 700,
      background: theme.header,
      color: '#fff',
      borderRadius: 8,
      padding: '0 5px',
      marginLeft: 2,
    },
    filterSection: {
      display: 'flex',
      flexDirection: 'column' as const,
      gap: 5,
      padding: '6px 6px 4px',
      background: theme.sectionBg,
      borderRadius: 4,
      border: `1px solid ${theme.accentBorder}`,
    },
    filterRow: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
    },
    filterLabel: {
      fontSize: 10,
      color: '#6b7280',
      width: 74,
      flexShrink: 0,
      fontFamily: 'monospace',
    },
    clearBtn: {
      fontSize: 10,
      color: theme.clearBtn,
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '2px 0',
      textAlign: 'left' as const,
      marginTop: 2,
    },
    inputHandle: {
      width: 8,
      height: 8,
      border: '2px solid #fff',
      position: 'absolute' as const,
      left: -5,
      borderRadius: '50%',
    },
    footer: {
      padding: '6px 10px 8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    fixtureControls: {
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    },
    fixtureToggle: {
      display: 'flex',
      alignItems: 'center',
      gap: 3,
      cursor: 'pointer',
      userSelect: 'none' as const,
      fontSize: 13,
    },
    fixtureSaveBtn: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '0 2px',
      fontSize: 13,
      color: '#6b7280',
      lineHeight: 1,
    },
    runBtn: {
      background: theme.runBtn,
      color: '#fff',
      border: 'none',
      borderRadius: 5,
      padding: '4px 14px',
      fontSize: 12,
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
}
