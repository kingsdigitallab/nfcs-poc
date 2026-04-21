import { useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { runMergeByQIDNode } from '../utils/runMergeByQIDNode'

export interface MergeByQIDNodeData {
  keepUnmatched:  boolean
  status:         'idle' | 'loading' | 'success' | 'error'
  statusMessage:  string
  mergedCount:    number
  unmatchedCount: number
  resultsVersion: number
  [key: string]:  unknown
}

const HEADER_COLOR = '#6b21a8'

export function MergeByQIDNode({ id }: NodeProps) {
  const { updateNodeData, getNodes, getEdges } = useReactFlow()

  const nodeData = getNodes().find(n => n.id === id)?.data as MergeByQIDNodeData | undefined
  const d: MergeByQIDNodeData = {
    keepUnmatched:  false,
    status:         'idle',
    statusMessage:  '',
    mergedCount:    0,
    unmatchedCount: 0,
    resultsVersion: 0,
    ...nodeData,
  }

  const handleRun = useCallback(
    () => runMergeByQIDNode(id, getNodes, getEdges(), updateNodeData),
    [id, getNodes, getEdges, updateNodeData],
  )

  const statusColor =
    d.status === 'error'   ? '#fca5a5' :
    d.status === 'success' ? '#a5f3fc' : '#e5e7eb'

  return (
    <div style={S.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={S.inHandle}  />
      <Handle type="source" position={Position.Right} id="results" style={S.outHandle} />

      <div style={S.header}>
        <span style={S.title}>Merge by QID</span>
        {d.statusMessage && (
          <span style={{ ...S.badge, color: statusColor }}>{d.statusMessage}</span>
        )}
      </div>

      <div style={S.body} className="nodrag nowheel">
        <p style={S.hint}>
          Groups records from all upstream sources by shared Wikidata QID.
          One merged record per entity; fields prefixed by source name.
        </p>

        <label style={S.chkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={d.keepUnmatched}
            onChange={e => updateNodeData(id, { keepUnmatched: e.target.checked })}
            className="nodrag"
          />
          Keep unmatched records (no QID)
        </label>

        {d.status === 'success' && (
          <div style={S.stats}>
            <span style={S.statItem}>🔗 {d.mergedCount} merged</span>
            {d.keepUnmatched && (
              <span style={{ ...S.statItem, color: '#9ca3af' }}>
                {d.unmatchedCount} unmatched
              </span>
            )}
          </div>
        )}
      </div>

      <div style={S.footer}>
        <button style={S.runBtn} onClick={handleRun} className="nodrag">
          ▶  Merge
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
    minWidth:     260,
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
  },
  hint: {
    fontSize:  10,
    color:     '#6b7280',
    margin:    0,
    lineHeight: 1.4,
  },
  chkLabel: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
    fontSize:   11,
    color:      '#374151',
    cursor:     'pointer',
  },
  stats: {
    display:        'flex',
    gap:            12,
    paddingTop:     2,
  },
  statItem: {
    fontSize:   11,
    fontWeight: 600,
    color:      '#15803d',
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
