import { useCallback } from 'react'
import { Handle, Position, useReactFlow, useEdges, NodeProps } from '@xyflow/react'
import { nodeRunners } from '../utils/nodeRunners'
import { downloadAsFixture, fixtureFilename, resolveFixtureQuery } from '../utils/fixtureUtils'

export type EuropeanaStatus = 'idle' | 'loading' | 'success' | 'error'

export interface EuropeanaSearchNodeData {
  apiKey:      string
  inlineQuery: string
  inlineLimit: string
  typeFilter:  string   // 'any' | 'IMAGE' | 'TEXT' | 'VIDEO' | 'SOUND' | '3D'
  reusability: string   // 'any' | 'open' | 'restricted' | 'permission'
  mediaOnly:   boolean
  status:      EuropeanaStatus
  statusMessage: string
  count:        number
  useFixture?:  boolean
  [key: string]: unknown
}

const HEADER_COLOR = '#2563eb'

const WIRABLE_ROWS = [
  { handleId: 'query', dataKey: 'inlineQuery', label: 'query', placeholder: 'search terms…' },
  { handleId: 'limit', dataKey: 'inlineLimit', label: 'limit', placeholder: '20  (max 1000)' },
] as const

const HEADER_H    = 32
const BODY_PAD    = 8
const ROW_H       = 27
// Pixel height consumed by the non-wirable API key row + hint before the first
// wirable row: apiKey row (22) + adjusted gap (3) + keyHint text (12) + gap (5)
const PRE_WIRABLE = 42

function handleTop(rowIndex: number) {
  return HEADER_H + BODY_PAD + PRE_WIRABLE + rowIndex * ROW_H + 11
}

const BORDER: Record<EuropeanaStatus, string> = {
  idle:    '#d1d5db',
  loading: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

export function EuropeanaSearchNode({ id, data }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: snap } = useReactFlow()
  const liveEdges = useEdges()
  const d = data as EuropeanaSearchNodeData

  const isConnected = (handleId: string) =>
    liveEdges.some(e => e.target === id && e.targetHandle === handleId)

  const handleRun = useCallback(
    () => nodeRunners.europeanaSearch(id, getNodes, snap(), updateNodeData),
    [id, updateNodeData, getNodes, snap],
  )

  const borderColor = BORDER[d.status as EuropeanaStatus] ?? BORDER.idle

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* apiKey handle — aligned with the API key input row */}
      <Handle
        type="target"
        position={Position.Left}
        id="apiKey"
        style={{
          ...styles.inputHandle,
          top: HEADER_H + BODY_PAD + 11,
          background: isConnected('apiKey') ? '#3b82f6' : '#9ca3af',
          boxShadow:  `0 0 0 1px ${isConnected('apiKey') ? '#3b82f6' : '#9ca3af'}`,
        }}
      />
      {/* Wirable input handles for query / limit */}
      {WIRABLE_ROWS.map(({ handleId }, i) => (
        <Handle
          key={handleId}
          type="target"
          position={Position.Left}
          id={handleId}
          style={{
            ...styles.inputHandle,
            top: handleTop(i),
            background: isConnected(handleId) ? '#3b82f6' : '#9ca3af',
            boxShadow:  `0 0 0 1px ${isConnected(handleId) ? '#3b82f6' : '#9ca3af'}`,
          }}
        />
      ))}

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Europeana Search</span>
        {d.statusMessage && (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        )}
      </div>

      <div style={styles.body}>
        {/* API key — display-only; value injected at build time */}
        <div style={styles.row}>
          <span style={styles.label}>API key</span>
          <span style={{
            ...styles.input,
            display:    'flex',
            alignItems: 'center',
            color:      isConnected('apiKey') ? '#1d4ed8' : d.apiKey ? '#15803d' : '#dc2626',
            background: isConnected('apiKey') ? '#eff6ff' : d.apiKey ? '#f0fdf4' : '#fef2f2',
            userSelect: 'none',
          }}>
            {isConnected('apiKey') ? '(from Param)' : d.apiKey ? '🔒 Configured' : '⚠ Not set'}
          </span>
        </div>
        <div style={styles.keyHint}>
          No key? Register free at{' '}
          <a href="https://apis.europeana.eu/apikey" target="_blank" rel="noreferrer" style={styles.keyLink} className="nodrag">
            apis.europeana.eu
          </a>
        </div>

        {/* Wirable rows */}
        {WIRABLE_ROWS.map(({ handleId, dataKey, label, placeholder }) => (
          <div key={handleId} style={styles.row}>
            <span style={styles.label}>{label}</span>
            <input
              style={{
                ...styles.input,
                background: isConnected(handleId) ? '#eff6ff' : '#fff',
                color:      isConnected(handleId) ? '#1d4ed8' : '#111827',
              }}
              value={(d[dataKey] as string) || ''}
              onChange={e => updateNodeData(id, { [dataKey]: e.target.value })}
              placeholder={isConnected(handleId) ? '(from ParamNode)' : placeholder}
              readOnly={isConnected(handleId)}
              className="nodrag"
            />
          </div>
        ))}

        {/* Type filter */}
        <div style={styles.row}>
          <span style={styles.label}>type</span>
          <select
            style={styles.select}
            value={(d.typeFilter as string) || 'any'}
            onChange={e => updateNodeData(id, { typeFilter: e.target.value })}
            className="nodrag"
          >
            <option value="any">Any type</option>
            <option value="IMAGE">Image</option>
            <option value="TEXT">Text</option>
            <option value="VIDEO">Video</option>
            <option value="SOUND">Sound</option>
            <option value="3D">3D</option>
          </select>
        </div>

        {/* Reusability */}
        <div style={styles.row}>
          <span style={styles.label}>reuse</span>
          <select
            style={styles.select}
            value={(d.reusability as string) || 'any'}
            onChange={e => updateNodeData(id, { reusability: e.target.value })}
            className="nodrag"
          >
            <option value="any">Any licence</option>
            <option value="open">Open (CC)</option>
            <option value="restricted">Restricted</option>
            <option value="permission">Permission required</option>
          </select>
        </div>

        {/* Media only checkbox */}
        <div style={{ ...styles.row, gap: 6 }}>
          <input
            type="checkbox"
            id={`media-${id}`}
            checked={!!(d.mediaOnly)}
            onChange={e => updateNodeData(id, { mediaOnly: e.target.checked })}
            className="nodrag"
          />
          <label htmlFor={`media-${id}`} style={styles.checkLabel} className="nodrag">
            Only items with media / thumbnail
          </label>
        </div>
      </div>

      <div style={styles.footer}>
        <div style={styles.fixtureControls}>
          {d.count ? (
            <span style={styles.countBadge}>
              {(d.count as number).toLocaleString()} total
            </span>
          ) : null}
          <label style={styles.fixtureToggle} className="nodrag" title="Use pre-baked fixture from public/fixtures/ instead of live API">
            <input type="checkbox" checked={!!d.useFixture} onChange={e => updateNodeData(id, { useFixture: e.target.checked })} className="nodrag" />
            <span style={{ color: d.useFixture ? HEADER_COLOR : '#9ca3af' }}>📦</span>
          </label>
          {(d.status === 'success' || d.status === 'cached') && (
            <button style={styles.fixtureSaveBtn} className="nodrag"
              title={`Download fixture: ${fixtureFilename('europeanaSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}`}
              onClick={() => downloadAsFixture(id, 'europeanaSearch', resolveFixtureQuery(id, liveEdges, getNodes(), d as Record<string, unknown>))}>
              💾
            </button>
          )}
        </div>
        <button
          style={{
            ...styles.runBtn,
            opacity: d.status === 'loading' ? 0.5 : 1,
          }}
          onClick={handleRun}
          disabled={d.status === 'loading'}
          className="nodrag"
        >
          {d.status === 'loading' ? 'Searching…' : d.useFixture ? '▶ Load fixture' : '▶ Run'}
        </button>
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
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
    maxWidth:     300,
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
    color:        '#bfdbfe',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  body: {
    padding:       '8px 10px 4px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           5,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  label: {
    fontSize:   11,
    color:      '#6b7280',
    width:      44,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  input: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 5px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    height:       22,
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    height:       22,
  },
  checkLabel: {
    fontSize: 10,
    color:    '#374151',
    cursor:   'pointer',
  },
  keyHint: {
    fontSize:   9,
    color:      '#9ca3af',
    paddingLeft: 50,
    marginTop:  -2,
  },
  keyLink: {
    color:          '#2563eb',
    textDecoration: 'none',
  },
  footer: {
    padding:        '5px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  countBadge: {
    fontSize:  10,
    color:     '#6b7280',
  },
  fixtureControls: { display: 'flex', alignItems: 'center', gap: 6, flex: 1 },
  fixtureToggle: { display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none' as const, fontSize: 13 },
  fixtureSaveBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontSize: 13, color: '#6b7280', lineHeight: 1 },
  runBtn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 14px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  inputHandle: {
    width:        8,
    height:       8,
    border:       '2px solid #fff',
    position:     'absolute' as const,
    left:         -5,
    borderRadius: '50%',
  },
  outputHandle: {
    width:      10,
    height:     10,
    background: '#22c55e',
    border:     '2px solid #fff',
    boxShadow:  '0 0 0 1px #22c55e',
  },
}
