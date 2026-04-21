import { useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { runWikidataEnrichNode } from '../utils/runWikidataEnrichNode'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { PROPERTY_GROUPS } from '../utils/wikidataApi'

export interface WikidataEnrichNodeData {
  reconcileField:     string       // '' = auto-detect first reconciled field
  selectedProperties: string[]     // P-numbers from the curated list
  customProperties:   string       // comma-separated additional P-numbers
  status:             'idle' | 'loading' | 'success' | 'error'
  statusMessage:      string
  count:              number
  resultsVersion:     number
  [key: string]:      unknown
}

const HEADER_COLOR = '#0369a1'

export function WikidataEnrichNode({ id }: NodeProps) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()
  const { records: upstream } = useUpstreamRecords(id)

  const nodeData = getNodes().find(n => n.id === id)?.data as WikidataEnrichNodeData | undefined
  const d: WikidataEnrichNodeData = {
    reconcileField:     '',
    selectedProperties: [],
    customProperties:   '',
    status:             'idle',
    statusMessage:      '',
    count:              0,
    resultsVersion:     0,
    ...nodeData,
  }

  // Collect *_reconciled field names from upstream records for the dropdown
  const reconciledFields: string[] = upstream?.length
    ? [...new Set(
        upstream.flatMap(r =>
          Object.keys(r as Record<string, unknown>).filter(k => k.endsWith('_reconciled')),
        ),
      )]
    : []

  const toggleProp = (propId: string) => {
    const current = d.selectedProperties
    const next = current.includes(propId)
      ? current.filter(p => p !== propId)
      : [...current, propId]
    updateNodeData(id, { selectedProperties: next })
  }

  const handleRun = useCallback(
    () => runWikidataEnrichNode(id, getNodes, getEdges(), updateNodeData),
    [id, getNodes, getEdges, updateNodeData],
  )

  const statusColor =
    d.status === 'error'   ? '#fca5a5' :
    d.status === 'success' ? '#a5f3fc' : '#e5e7eb'

  const totalSelected =
    d.selectedProperties.length +
    d.customProperties.split(',').filter(p => p.trim().match(/^P\d+$/)).length

  return (
    <div style={S.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={S.inHandle}  />
      <Handle type="source" position={Position.Right} id="results" style={S.outHandle} />

      <div style={S.header}>
        <span style={S.title}>Wikidata Enrich</span>
        {d.statusMessage && (
          <span style={{ ...S.badge, color: statusColor }}>{d.statusMessage}</span>
        )}
      </div>

      <div style={S.body} className="nodrag nowheel">

        {/* Reconciled field selector */}
        <div style={S.row}>
          <label style={S.label}>QID field</label>
          <select
            value={d.reconcileField}
            onChange={e => updateNodeData(id, { reconcileField: e.target.value })}
            style={S.sel}
            className="nodrag"
          >
            <option value="">— auto-detect —</option>
            {reconciledFields.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        {/* Property groups */}
        <div style={S.groupsWrap}>
          {PROPERTY_GROUPS.map(group => (
            <div key={group.label} style={S.group}>
              <div style={S.groupLabel}>{group.label}</div>
              <div style={S.propGrid}>
                {group.properties.map(prop => {
                  const checked = d.selectedProperties.includes(prop.id)
                  return (
                    <label
                      key={prop.id}
                      style={{ ...S.propLabel, background: checked ? '#ede9fe' : '#f9fafb' }}
                      className="nodrag"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProp(prop.id)}
                        className="nodrag"
                      />
                      <span style={S.propText}>
                        <span style={S.propName}>{prop.label}</span>
                        <span style={S.propId}>{prop.id}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Custom properties */}
        <div style={S.row}>
          <label style={S.label}>Custom P-IDs</label>
          <input
            type="text"
            value={d.customProperties}
            onChange={e => updateNodeData(id, { customProperties: e.target.value })}
            placeholder="P123, P456…"
            style={S.inp}
            className="nodrag"
          />
        </div>

        {totalSelected > 0 && (
          <div style={S.selCount}>{totalSelected} propert{totalSelected === 1 ? 'y' : 'ies'} selected</div>
        )}
      </div>

      <div style={S.footer}>
        <button
          style={{ ...S.runBtn, opacity: totalSelected === 0 ? 0.45 : 1 }}
          disabled={totalSelected === 0}
          onClick={handleRun}
          className="nodrag"
        >
          ▶  Enrich
        </button>
      </div>
    </div>
  )
}

const S = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth:     300,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    position:     'relative' as const,
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
  title: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  badge: {
    fontSize:     10,
    fontWeight:   600,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  body: {
    padding:       '10px 12px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           8,
    maxHeight:     400,
    overflowY:     'auto' as const,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
  },
  label: {
    fontSize:   10,
    fontWeight: 600,
    color:      '#6b7280',
    flexShrink: 0,
    width:      58,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  sel: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
  },
  inp: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 6px',
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
  },
  groupsWrap: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
  },
  group: {
    border:        '1px solid #e5e7eb',
    borderRadius:  4,
    overflow:      'hidden',
  },
  groupLabel: {
    fontSize:      10,
    fontWeight:    700,
    color:         '#374151',
    background:    '#f3f4f6',
    padding:       '3px 8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  propGrid: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           1,
    padding:       '3px 4px',
  },
  propLabel: {
    display:      'flex',
    alignItems:   'center',
    gap:          6,
    padding:      '2px 4px',
    borderRadius: 3,
    cursor:       'pointer',
  },
  propText: {
    display:    'flex',
    alignItems: 'baseline',
    gap:        5,
  },
  propName: {
    fontSize: 11,
    color:    '#1f2937',
  },
  propId: {
    fontSize:    9,
    color:       '#9ca3af',
    fontFamily:  'monospace',
  },
  selCount: {
    fontSize:   10,
    color:      HEADER_COLOR,
    fontWeight: 600,
    textAlign:  'right' as const,
  },
  footer: {
    padding:        '6px 12px 10px',
    display:        'flex',
    justifyContent: 'flex-end',
    borderTop:      '1px solid #f0f0f0',
  },
  runBtn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 16px',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  inHandle: {
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
  },
  outHandle: {
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
    top:        13,
  },
}
