/**
 * BackboneSearchNode — shared shell for search-service nodes. Originally the
 * ARIADNE/HSDS shell (the two components were ~82% identical); task-SN.1
 * generalised the config so services with different filter panels, optional
 * sort rows and footer extras (MDS, LLDS, V&A, SMG, Bodleian) fit without
 * touching the chrome. Europeana and GBIF stay bespoke by design — their
 * HANDLE LAYOUTS differ (extra apiKey row / five wirable rows) and the
 * serialised-edge contract must not move for anyone else's sake.
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
import { FONT, NEUTRAL, ACCENT, RADIUS, SHADOW, STATUS_BORDER, STATUS_BADGE } from '../styles/theme'

export type BackboneStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

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

/** One declarative row in the Filters panel. `range` renders From/To inputs
 *  backed by the `${key}From` / `${key}To` data keys. */
export interface FilterSpec {
  key:   string
  label: string
  kind:  'select' | 'text' | 'checkbox' | 'range'
  /** select — plain strings ('' renders '— any —') or explicit value/label pairs */
  options?: string[] | { value: string; label: string }[]
  /** text */
  placeholder?: string
  /** text — datalist suggestions */
  suggestions?: string[]
  /** range — placeholders for the From / To inputs */
  rangePlaceholders?: [string, string]
}

export interface BackboneSearchConfig {
  /** Node type string — nodeRunners registry key AND fixture filename prefix */
  nodeType: string
  /** Header label, e.g. 'ARIADNE Search' */
  title: string
  theme: BackboneTheme
  /** Query row placeholder (default 'e.g. Stonehenge') */
  queryPlaceholder?: string
  /** Query row label (default 'query'; MDS shows 'q') */
  queryLabel?: string
  /** node.data key behind the query row (default 'inlineQuery') —
   *  must match what the node's runner reads */
  queryDataKey?: string
  /** Sort row; omit for no sort UI. singleSelect drops the ↓/↑ order arrow. */
  sort?: {
    options: { value: string; label: string }[]
    defaultValue?: string
    singleSelect?: boolean
  }
  /** Fetch-all checkbox; omit to hide. Object form overrides the label. */
  fetchAll?: true | { label: string }
  /** Extra select row between the wirable rows and the fetch-all checkbox
   *  (SMG search type). The value lives at data[key]. */
  extraBodyRow?: { key: string; label: string; options: { value: string; label: string }[] }
  /** Declarative filter panel; omit for no Filters toggle. */
  filters?: FilterSpec[]
  footer?: {
    /** Small italic caption, e.g. MDS's scraper disclaimer — renders left of the toggles */
    caption?: string
    /** Extra footer toggle rendered BEFORE the fixture toggle (LLDS cache mode).
     *  Bound to data[key] as boolean; `cachedLabel` shows while status === 'cached'. */
    extraToggle?: {
      key: string; label: string; cachedLabel?: string
      title?: string; onColor?: string; offColor?: string
    }
  }
  /** MDS-style capped indicator: statusMessage text turns amber when the
   *  runner set `_capped` on the node data. */
  cappedAmberStatus?: boolean
  /** Per-status border-colour overrides (e.g. LLDS 'cached': '#f59e0b') */
  statusColours?: Partial<Record<string, string>>
  /** Per-status statusMessage-colour overrides */
  statusBadgeColours?: Partial<Record<string, string>>
  /** Card min-width (default 264; MDS/LLDS use 240) */
  minWidth?: number
}

// ── Layout (shared by every backbone node — handle offsets depend on these) ──

const HEADER_H = 32
const BODY_PAD = 8
const ROW_H    = 27

/** Exported for the handle-contract regression test (backboneHandles.test.ts). */
export function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + rowIndex * ROW_H + 11
}

/** Data keys a FilterSpec writes (range specs own two). */
export function filterValueKeys(spec: FilterSpec): string[] {
  return spec.kind === 'range' ? [`${spec.key}From`, `${spec.key}To`] : [spec.key]
}

function isFilterActive(spec: FilterSpec, d: Record<string, unknown>): boolean {
  if (spec.kind === 'checkbox') return d[spec.key] === true
  return filterValueKeys(spec).some(k => Boolean(d[k]))
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BackboneSearchNode({ id, data, config }: NodeProps & { config: BackboneSearchConfig }) {
  const { updateNodeData, getNodes, getEdges: getEdgesSnap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as Record<string, unknown>
  const [filtersOpen, setFiltersOpen] = useState(false)

  const styles      = stylesFor(config)
  const hasFetchAll = config.fetchAll !== undefined
  const fetchAll    = hasFetchAll && ((d.fetchAll as boolean | undefined) ?? false)
  const status      = d.status as BackboneStatus
  const borderColor = config.statusColours?.[status] ?? STATUS_BORDER[status] ?? '#d6ccb5'
  const filters     = config.filters ?? []

  const wirableRows = [
    {
      handleId:    'query',
      dataKey:     config.queryDataKey ?? 'inlineQuery',
      label:       config.queryLabel ?? 'query',
      placeholder: config.queryPlaceholder ?? 'e.g. Stonehenge',
      rowIndex:    0,
    },
    { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20', rowIndex: 1 },
  ]

  const isConnected = useCallback(
    (handleId: string) => liveEdges.some(e => e.target === id && e.targetHandle === handleId),
    [liveEdges, id],
  )

  const handleRun = useCallback(
    () => nodeRunners[config.nodeType](id, getNodes, getEdgesSnap(), updateNodeData),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, updateNodeData, getNodes, getEdgesSnap],  // config is module-constant per node type
  )

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    updateNodeData(id, { [key]: e.target.value })

  const activeFilterCount = filters.filter(f => isFilterActive(f, d)).length

  return (
    <div style={{ ...styles.card, borderColor }}>
      {wirableRows.map(({ handleId, rowIndex }) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(rowIndex),
            background: isConnected(handleId) ? '#3b82f6' : '#b0a891',
            boxShadow: `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#b0a891'}`,
          }}
        />
      ))}

      <div style={styles.header}>
        <span style={styles.headerTitle}>{config.title}</span>
        {d.statusMessage ? (
          <span style={{
            ...styles.statusBadge,
            color: (config.cappedAmberStatus && d._capped === true)
              ? '#fbbf24'
              : config.statusBadgeColours?.[status] ?? STATUS_BADGE[status] ?? '#b0a891',
          }}>
            {d.statusMessage as string}
          </span>
        ) : null}
      </div>

      <div style={styles.body}>
        {wirableRows.map(({ handleId, dataKey, label, placeholder }) => {
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

        {config.extraBodyRow && (
          <div style={styles.row}>
            <span style={styles.paramLabel}>{config.extraBodyRow.label}</span>
            <select
              style={styles.select}
              value={(d[config.extraBodyRow.key] as string) || config.extraBodyRow.options[0]?.value || ''}
              onChange={set(config.extraBodyRow.key)}
              className="nodrag"
            >
              {config.extraBodyRow.options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}

        {hasFetchAll && (
          <label style={styles.checkLabel} className="nodrag">
            <input
              type="checkbox"
              checked={fetchAll}
              onChange={e => updateNodeData(id, { fetchAll: e.target.checked })}
              style={{ marginRight: 5 }}
            />
            {typeof config.fetchAll === 'object' ? config.fetchAll.label : 'Fetch all results'}
          </label>
        )}

        {config.sort && (
          <div style={styles.row}>
            <span style={styles.paramLabel}>sort</span>
            <select
              style={styles.select}
              value={(d.sort as string) || config.sort.defaultValue || '_score'}
              onChange={set('sort')}
              className="nodrag"
            >
              {config.sort.options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!config.sort.singleSelect && (
              <select style={{ ...styles.select, width: 52 }} value={(d.order as string) || 'desc'} onChange={set('order')} className="nodrag">
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
            )}
          </div>
        )}

        {filters.length > 0 && (
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
        )}

        {filtersOpen && filters.length > 0 && (
          <div style={styles.filterSection}>
            {filters.map(spec => (
              <div key={spec.key} style={styles.filterRow}>
                <span style={styles.filterLabel}>{spec.label}</span>
                {spec.kind === 'select' && (
                  <select style={styles.select} value={(d[spec.key] as string) || ''} onChange={set(spec.key)} className="nodrag">
                    {(spec.options ?? []).map(o => {
                      const { value, label } = typeof o === 'string' ? { value: o, label: o || '— any —' } : o
                      return <option key={value} value={value}>{label}</option>
                    })}
                  </select>
                )}
                {spec.kind === 'text' && (
                  <>
                    <input
                      list={spec.suggestions ? `${id}-${spec.key}` : undefined}
                      style={styles.inlineInput}
                      value={(d[spec.key] as string) || ''}
                      onChange={set(spec.key)}
                      placeholder={spec.placeholder}
                      className="nodrag"
                    />
                    {spec.suggestions && (
                      <datalist id={`${id}-${spec.key}`}>
                        {spec.suggestions.map(v => <option key={v} value={v} />)}
                      </datalist>
                    )}
                  </>
                )}
                {spec.kind === 'checkbox' && (
                  <input
                    type="checkbox"
                    checked={d[spec.key] === true}
                    onChange={e => updateNodeData(id, { [spec.key]: e.target.checked })}
                    className="nodrag"
                  />
                )}
                {spec.kind === 'range' && (
                  <>
                    <input
                      style={{ ...styles.inlineInput, flex: 1 }}
                      value={(d[`${spec.key}From`] as string) || ''}
                      onChange={set(`${spec.key}From`)}
                      placeholder={spec.rangePlaceholders?.[0] ?? 'from'}
                      className="nodrag"
                    />
                    <span style={styles.rangeDash}>–</span>
                    <input
                      style={{ ...styles.inlineInput, flex: 1 }}
                      value={(d[`${spec.key}To`] as string) || ''}
                      onChange={set(`${spec.key}To`)}
                      placeholder={spec.rangePlaceholders?.[1] ?? 'to'}
                      className="nodrag"
                    />
                  </>
                )}
              </div>
            ))}

            {activeFilterCount > 0 && (
              <button
                style={styles.clearBtn}
                onClick={() => updateNodeData(id, Object.fromEntries(
                  filters.flatMap<[string, string | boolean]>(spec =>
                    spec.kind === 'checkbox'
                      ? [[spec.key, false]]
                      : filterValueKeys(spec).map(k => [k, ''] as [string, string | boolean])),
                ))}
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
          {config.footer?.caption && (
            <span style={styles.footerCaption}>{config.footer.caption}</span>
          )}
          {config.footer?.extraToggle && (
            <label style={styles.extraToggle} className="nodrag" title={config.footer.extraToggle.title}>
              <input
                type="checkbox"
                checked={d[config.footer.extraToggle.key] === true}
                onChange={e => updateNodeData(id, { [config.footer!.extraToggle!.key]: e.target.checked })}
                className="nodrag"
              />
              <span style={{
                color: d[config.footer.extraToggle.key] === true
                  ? (config.footer.extraToggle.onColor ?? config.theme.fixtureIcon)
                  : (config.footer.extraToggle.offColor ?? '#b0a891'),
              }}>
                {status === 'cached' && config.footer.extraToggle.cachedLabel
                  ? config.footer.extraToggle.cachedLabel
                  : config.footer.extraToggle.label}
              </span>
            </label>
          )}
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture from public/fixtures/ instead of live API">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? config.theme.fixtureIcon : '#b0a891' }}>📦</span>
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

const styleCache = new Map<BackboneSearchConfig, ReturnType<typeof buildStyles>>()

function stylesFor(config: BackboneSearchConfig) {
  let s = styleCache.get(config)
  if (!s) {
    s = buildStyles(config)
    styleCache.set(config, s)
  }
  return s
}

function buildStyles(config: BackboneSearchConfig) {
  const theme = config.theme
  return {
    card: {
      background: NEUTRAL.card,
      border: `1.5px solid ${NEUTRAL.cardBorder}`,
      borderRadius: RADIUS.node,
      minWidth: config.minWidth ?? 264,
      boxShadow: SHADOW.node,
      position: 'relative' as const,
      transition: 'border-color 0.25s',
      fontFamily: FONT.sans,
    },
    header: {
      height: HEADER_H,
      background: theme.header,
      borderRadius: '6px 6px 0 0',
      padding: '0 11px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    },
    headerTitle: {
      color: '#fff', fontFamily: FONT.serif, fontWeight: 600, fontSize: 12.5, flexShrink: 0,
    },
    statusBadge: {
      fontSize: 10, fontWeight: 600,
      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
    },
    body: {
      paddingTop: BODY_PAD, paddingLeft: 14, paddingRight: 11, paddingBottom: 4,
      display: 'flex', flexDirection: 'column' as const, gap: 6,
    },
    row: { display: 'flex', alignItems: 'center', gap: 6, height: ROW_H - 5 },
    paramLabel: {
      fontSize: 11, color: NEUTRAL.muted, width: 40, flexShrink: 0, fontFamily: FONT.mono,
    },
    inlineInput: {
      flex: 1, fontSize: 11.5, padding: '2px 6px',
      border: `1px solid ${NEUTRAL.inputBorder}`, borderRadius: RADIUS.input,
      outline: 'none', minWidth: 0, height: 22, background: '#fff', color: NEUTRAL.body,
    },
    select: {
      flex: 1, fontSize: 11.5, padding: '2px 5px',
      border: `1px solid ${NEUTRAL.inputBorder}`, borderRadius: RADIUS.input,
      outline: 'none', height: 22, background: '#fff', color: NEUTRAL.body, minWidth: 0,
    },
    connectedBadge: { fontSize: 10.5, color: ACCENT.blue, fontStyle: 'italic' as const, fontFamily: FONT.serif },
    disabledHint:   { fontSize: 10.5, color: NEUTRAL.faint, fontStyle: 'italic' as const },
    checkLabel: {
      display: 'flex', alignItems: 'center', fontSize: 11.5, color: '#4a4636',
      cursor: 'pointer', userSelect: 'none' as const, paddingTop: 2,
    },
    filterToggle: {
      display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600,
      color: theme.header, background: theme.accentBg, border: `1px solid ${theme.accentBorder}`,
      borderRadius: RADIUS.input, padding: '4px 9px', cursor: 'pointer', marginTop: 2,
      width: '100%', textAlign: 'left' as const,
    },
    filterBadge: {
      fontSize: 10, fontWeight: 700, background: theme.header, color: '#fff',
      borderRadius: 8, padding: '0 5px', marginLeft: 2,
    },
    filterSection: {
      display: 'flex', flexDirection: 'column' as const, gap: 5, padding: '6px 6px 4px',
      background: theme.sectionBg, borderRadius: RADIUS.input, border: `1px solid ${theme.accentBorder}`,
    },
    filterRow: { display: 'flex', alignItems: 'center', gap: 6 },
    filterLabel: { fontSize: 10, color: NEUTRAL.muted, width: 74, flexShrink: 0, fontFamily: FONT.mono },
    rangeDash: { fontSize: 10, color: NEUTRAL.faint, flexShrink: 0 },
    clearBtn: {
      fontSize: 10, color: theme.clearBtn, background: 'none', border: 'none',
      cursor: 'pointer', padding: '2px 0', textAlign: 'left' as const, marginTop: 2,
    },
    inputHandle: {
      width: 8, height: 8, border: '2px solid ' + NEUTRAL.card,
      position: 'absolute' as const, left: -5, borderRadius: '50%',
    },
    footer: {
      padding: '7px 11px 9px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', gap: 6,
    },
    fixtureControls: { display: 'flex', alignItems: 'center', gap: 4 },
    fixtureToggle: {
      display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
      userSelect: 'none' as const, fontSize: 13,
    },
    extraToggle: {
      display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer',
      userSelect: 'none' as const, fontSize: 10, fontWeight: 600,
    },
    footerCaption: {
      fontSize: 9, color: NEUTRAL.faint, fontStyle: 'italic' as const,
      fontFamily: FONT.serif, lineHeight: 1.3, maxWidth: 120,
    },
    fixtureSaveBtn: {
      background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
      fontSize: 13, color: NEUTRAL.muted, lineHeight: 1,
    },
    runBtn: {
      background: theme.runBtn, color: ACCENT.actionFg, border: 'none',
      borderRadius: RADIUS.header, padding: '4px 14px', fontSize: 12, fontWeight: 600,
      cursor: 'pointer', fontFamily: FONT.sans,
    },
    outputHandle: {
      width: 10, height: 10, background: STATUS_BORDER.success,
      border: '2px solid ' + NEUTRAL.card, boxShadow: `0 0 0 1px ${STATUS_BORDER.success}`,
    },
  }
}
