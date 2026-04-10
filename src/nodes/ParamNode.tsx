import { useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'

export type ParamType = 'Text' | 'Integer'

export interface ParamNodeData {
  label: string
  paramType: ParamType
  value: string
  [key: string]: unknown
}

export function ParamNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as ParamNodeData

  const setField = useCallback(
    (field: keyof ParamNodeData, val: string) => {
      updateNodeData(id, { [field]: val })
    },
    [id, updateNodeData],
  )

  const handleValueChange = useCallback(
    (raw: string) => {
      if (d.paramType === 'Integer') {
        // Allow empty, minus sign, or valid integers only
        if (raw === '' || raw === '-' || /^-?\d+$/.test(raw)) {
          setField('value', raw)
        }
      } else {
        setField('value', raw)
      }
    },
    [d.paramType, setField],
  )

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <input
          style={styles.labelInput}
          value={d.label}
          onChange={e => setField('label', e.target.value)}
          placeholder="Label"
          className="nodrag"
        />
      </div>
      <div style={styles.body}>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Type</span>
          <select
            style={styles.select}
            value={d.paramType}
            onChange={e => setField('paramType', e.target.value)}
            className="nodrag"
          >
            <option value="Text">Text</option>
            <option value="Integer">Integer</option>
          </select>
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Value</span>
          <input
            style={styles.valueInput}
            value={d.value}
            onChange={e => handleValueChange(e.target.value)}
            placeholder={d.paramType === 'Integer' ? '0' : 'enter value…'}
            className="nodrag"
          />
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={styles.handle}
      />
    </div>
  )
}

const styles = {
  card: {
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 8,
    minWidth: 200,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
  },
  header: {
    background: '#3b82f6',
    borderRadius: '7px 7px 0 0',
    padding: '6px 10px',
  },
  labelInput: {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#fff',
    fontWeight: 600,
    fontSize: 12,
    width: '100%',
  },
  body: {
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  rowLabel: {
    color: '#6b7280',
    fontSize: 11,
    width: 36,
    flexShrink: 0,
  },
  select: {
    flex: 1,
    fontSize: 12,
    padding: '3px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    background: '#f9fafb',
    outline: 'none',
  },
  valueInput: {
    flex: 1,
    fontSize: 12,
    padding: '3px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
  },
  handle: {
    width: 10,
    height: 10,
    background: '#3b82f6',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #3b82f6',
  },
}
