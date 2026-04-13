/**
 * FilterTransformNode — processing node that filters and/or transforms upstream
 * records before passing them to output nodes.
 *
 * Modes:
 *   filter    — reduces records by one or more conditions (AND/OR)
 *   transform — mutates field values without removing records
 *   both      — filter first, then transform
 */

import { useCallback } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { runFilterTransformNode } from '../utils/runFilterTransformNode'
import { candidateFields } from '../utils/reconciliationService'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ─── types (exported — used by runner and utils) ──────────────────────────────

export type FilterOperator =
  | 'contains' | 'equals' | 'startsWith'
  | 'isEmpty'  | 'isNotEmpty'
  | 'greaterThan' | 'lessThan'

export interface FilterOp {
  id:       string
  field:    string
  operator: FilterOperator
  value:    string
}

export interface RenameOp    { id: string; type: 'rename';    field: string; newName: string; dropOriginal: boolean }
export interface ExtractOp   { id: string; type: 'extract';   field: string; newField: string; start: string; end: string; regex: string; useRegex: boolean }
export interface ConcatOp    { id: string; type: 'concat';    field1: string; field2: string; newField: string; separator: string }
export interface LowercaseOp { id: string; type: 'lowercase'; field: string }
export interface UppercaseOp { id: string; type: 'uppercase'; field: string }
export interface TruncateOp  { id: string; type: 'truncate';  field: string; maxLen: string }

export type TransformOp   = RenameOp | ExtractOp | ConcatOp | LowercaseOp | UppercaseOp | TruncateOp
export type TransformType = TransformOp['type']
export type FTMode        = 'filter' | 'transform' | 'both'

export interface FilterTransformNodeData {
  mode:             FTMode
  filterCombinator: 'AND' | 'OR'
  filterOps:        FilterOp[]
  transformOps:     TransformOp[]
  status:           'idle' | 'success' | 'error'
  statusMessage:    string
  results:          UnifiedRecord[] | undefined
  inputCount:       number
  outputCount:      number
  [key: string]:    unknown
}

// ─── operator / type metadata ─────────────────────────────────────────────────

const OPERATORS: { value: FilterOperator; label: string; noValue?: true }[] = [
  { value: 'contains',    label: 'contains' },
  { value: 'equals',      label: '=' },
  { value: 'startsWith',  label: 'starts with' },
  { value: 'greaterThan', label: '>' },
  { value: 'lessThan',    label: '<' },
  { value: 'isEmpty',     label: 'is empty',  noValue: true },
  { value: 'isNotEmpty',  label: 'not empty', noValue: true },
]

const TRANSFORM_TYPES: { value: TransformType; label: string }[] = [
  { value: 'rename',    label: 'Rename field' },
  { value: 'lowercase', label: 'Lowercase' },
  { value: 'uppercase', label: 'Uppercase' },
  { value: 'truncate',  label: 'Truncate' },
  { value: 'extract',   label: 'Extract' },
  { value: 'concat',    label: 'Concatenate' },
]

// ─── op factories ─────────────────────────────────────────────────────────────

function newOpId() { return `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

function defaultFilterOp(): FilterOp {
  return { id: newOpId(), field: '', operator: 'contains', value: '' }
}

function defaultTransformOp(type: TransformType = 'rename'): TransformOp {
  const id = newOpId()
  switch (type) {
    case 'rename':    return { id, type, field: '', newName: '', dropOriginal: false }
    case 'extract':   return { id, type, field: '', newField: '', start: '', end: '', regex: '', useRegex: false }
    case 'concat':    return { id, type, field1: '', field2: '', newField: '', separator: ' ' }
    case 'lowercase': return { id, type, field: '' }
    case 'uppercase': return { id, type, field: '' }
    case 'truncate':  return { id, type, field: '', maxLen: '100' }
  }
}

// ─── FilterRow ────────────────────────────────────────────────────────────────

interface FilterRowProps {
  op:                  FilterOp
  fields:              string[]
  onChange:            (patch: Partial<FilterOp>) => void
  onDelete:            () => void
  showCombinator:      boolean
  combinator:          'AND' | 'OR'
  onToggleCombinator:  () => void
}

function FilterRow({ op, fields, onChange, onDelete, showCombinator, combinator, onToggleCombinator }: FilterRowProps) {
  const noValue = OPERATORS.find(o => o.value === op.operator)?.noValue

  return (
    <div>
      <div style={S.filterRow}>
        <select
          value={op.field}
          onChange={e => onChange({ field: e.target.value })}
          style={{ ...S.sel, flex: 1, minWidth: 0 }}
          className="nodrag"
        >
          <option value="">— field —</option>
          {fields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select
          value={op.operator}
          onChange={e => onChange({ operator: e.target.value as FilterOperator })}
          style={{ ...S.sel, width: 78 }}
          className="nodrag"
        >
          {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {!noValue && (
          <input
            type="text"
            value={op.value}
            onChange={e => onChange({ value: e.target.value })}
            style={{ ...S.inp, flex: 1, minWidth: 0 }}
            placeholder="value…"
            className="nodrag"
          />
        )}
        <button onClick={onDelete} style={S.deleteBtn} className="nodrag">×</button>
      </div>
      {showCombinator && (
        <div style={S.combinatorRow}>
          <button
            style={{ ...S.combinatorPill, background: combinator === 'AND' ? '#4f46e5' : '#10b981' }}
            onClick={onToggleCombinator}
            className="nodrag"
          >
            {combinator}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── TransformRow ─────────────────────────────────────────────────────────────

interface TransformRowProps {
  op:       TransformOp
  fields:   string[]
  onChange: (op: TransformOp) => void
  onDelete: () => void
}

function TransformRow({ op, fields, onChange, onDelete }: TransformRowProps) {

  const fieldSel = (val: string, onCh: (v: string) => void, ph = '— field —') => (
    <select
      value={val}
      onChange={e => onCh(e.target.value)}
      style={{ ...S.sel, flex: 1, minWidth: 0 }}
      className="nodrag"
    >
      <option value="">{ph}</option>
      {fields.map(f => <option key={f} value={f}>{f}</option>)}
    </select>
  )

  const textInp = (val: string, onCh: (v: string) => void, ph = '', width?: number) => (
    <input
      type="text"
      value={val}
      onChange={e => onCh(e.target.value)}
      style={{ ...S.inp, ...(width ? { width, flex: 'none' } : { flex: 1, minWidth: 0 }) }}
      placeholder={ph}
      className="nodrag"
    />
  )

  const numInp = (val: string, onCh: (v: string) => void, ph = '') => (
    <input
      type="number"
      value={val}
      onChange={e => onCh(e.target.value)}
      style={{ ...S.inp, width: 46, flex: 'none' as const }}
      placeholder={ph}
      className="nodrag"
    />
  )

  // Type change rebuilds the whole op (keeps only the id)
  const onTypeChange = (newType: TransformType) =>
    onChange({ ...defaultTransformOp(newType), id: op.id })

  // Field-level change merges into current op
  const patch = (p: Partial<TransformOp>) => onChange({ ...op, ...p } as TransformOp)

  return (
    <div style={S.transformBlock}>
      {/* Row 1: type selector + delete */}
      <div style={S.transformHeader}>
        <select
          value={op.type}
          onChange={e => onTypeChange(e.target.value as TransformType)}
          style={{ ...S.sel, flex: 1, fontWeight: 600 }}
          className="nodrag"
        >
          {TRANSFORM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={onDelete} style={S.deleteBtn} className="nodrag">×</button>
      </div>

      {/* Row 2+: type-specific config */}
      <div style={S.transformConfig}>

        {op.type === 'rename' && (
          <>
            {fieldSel(op.field, v => patch({ field: v }))}
            <span style={S.arrow}>→</span>
            {textInp(op.newName, v => patch({ newName: v }), 'new name')}
            <label style={S.chkLabel} className="nodrag">
              <input
                type="checkbox"
                checked={op.dropOriginal}
                onChange={e => patch({ dropOriginal: e.target.checked })}
                className="nodrag"
              />
              drop
            </label>
          </>
        )}

        {(op.type === 'lowercase' || op.type === 'uppercase') &&
          fieldSel(op.field, v => patch({ field: v }))
        }

        {op.type === 'truncate' && (
          <>
            {fieldSel(op.field, v => patch({ field: v }))}
            {numInp(op.maxLen, v => patch({ maxLen: v }), '100')}
            <span style={S.unit}>chars</span>
          </>
        )}

        {op.type === 'extract' && (
          <div style={S.multiLineConfig}>
            <div style={S.configLine}>
              {fieldSel(op.field, v => patch({ field: v }))}
              <span style={S.arrow}>→</span>
              {textInp(op.newField, v => patch({ newField: v }), 'output field')}
            </div>
            <div style={S.configLine}>
              <label style={S.chkLabel} className="nodrag">
                <input
                  type="checkbox"
                  checked={op.useRegex}
                  onChange={e => patch({ useRegex: e.target.checked })}
                  className="nodrag"
                />
                regex
              </label>
              {op.useRegex
                ? textInp(op.regex, v => patch({ regex: v }), 'pattern (group 1)')
                : <>
                    <span style={S.unit}>start</span>
                    {numInp(op.start, v => patch({ start: v }), '0')}
                    <span style={S.unit}>end</span>
                    {numInp(op.end, v => patch({ end: v }), '')}
                  </>
              }
            </div>
          </div>
        )}

        {op.type === 'concat' && (
          <div style={S.multiLineConfig}>
            <div style={S.configLine}>
              {fieldSel(op.field1, v => patch({ field1: v }), '— field 1 —')}
              <span style={S.unit}>+</span>
              {fieldSel(op.field2, v => patch({ field2: v }), '— field 2 —')}
            </div>
            <div style={S.configLine}>
              <span style={S.arrow}>→</span>
              {textInp(op.newField, v => patch({ newField: v }), 'output field')}
              <span style={S.unit}>sep</span>
              {textInp(op.separator, v => patch({ separator: v }), '', 34)}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── main component ───────────────────────────────────────────────────────────

const HEADER_COLOR = '#4f46e5'  // indigo-600

export function FilterTransformNode({ id }: NodeProps) {
  const { updateNodeData, getNodes, getEdges: snap } = useReactFlow()
  const { records: upstreamRecords, connected } = useUpstreamRecords(id)

  const nodeData = getNodes().find(n => n.id === id)?.data as FilterTransformNodeData | undefined
  const d: FilterTransformNodeData = {
    mode:             'filter',
    filterCombinator: 'AND',
    filterOps:        [],
    transformOps:     [],
    status:           'idle',
    statusMessage:    '',
    results:          undefined,
    inputCount:       0,
    outputCount:      0,
    ...nodeData,
  }

  const fields = upstreamRecords?.[0]
    ? candidateFields(upstreamRecords[0] as unknown as Record<string, unknown>)
    : []

  // ── op update helpers (read fresh from store each call) ───────────────────

  const readData = () =>
    getNodes().find(n => n.id === id)?.data as FilterTransformNodeData

  const updateFilterOp = (opId: string, p: Partial<FilterOp>) => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { filterOps: cur.filterOps.map(op => op.id === opId ? { ...op, ...p } : op) })
  }

  const deleteFilterOp = (opId: string) => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { filterOps: cur.filterOps.filter(op => op.id !== opId) })
  }

  const addFilterOp = () => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { filterOps: [...cur.filterOps, defaultFilterOp()] })
  }

  const updateTransformOp = (newOp: TransformOp) => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { transformOps: cur.transformOps.map(op => op.id === newOp.id ? newOp : op) })
  }

  const deleteTransformOp = (opId: string) => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { transformOps: cur.transformOps.filter(op => op.id !== opId) })
  }

  const addTransformOp = () => {
    const cur = readData()
    if (!cur) return
    updateNodeData(id, { transformOps: [...cur.transformOps, defaultTransformOp()] })
  }

  const handleRun = useCallback(
    () => runFilterTransformNode(id, getNodes, snap(), updateNodeData),
    [id, getNodes, snap, updateNodeData],
  )

  const showFilter    = d.mode === 'filter'    || d.mode === 'both'
  const showTransform = d.mode === 'transform' || d.mode === 'both'

  return (
    <div style={S.card}>
      <Handle type="target" position={Position.Left}  id="data"    style={S.inHandle} />
      <Handle type="source" position={Position.Right} id="results" style={S.outHandle} />

      {/* Header */}
      <div style={S.header}>
        <span style={S.headerTitle}>Filter / Transform</span>
        {d.statusMessage && (
          <span style={{ ...S.statusBadge, color: d.status === 'error' ? '#fca5a5' : '#a5f3fc' }}>
            {d.statusMessage}
          </span>
        )}
      </div>

      {/* Mode tabs */}
      <div style={S.modeTabs}>
        {(['filter', 'transform', 'both'] as FTMode[]).map(m => (
          <button
            key={m}
            style={{
              ...S.modeTab,
              background: d.mode === m ? HEADER_COLOR : 'transparent',
              color:      d.mode === m ? '#fff' : '#6b7280',
              fontWeight: d.mode === m ? 700 : 400,
            }}
            onClick={() => updateNodeData(id, { mode: m })}
            className="nodrag"
          >
            {m === 'both' ? 'Both' : m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>

      {/* Body — scrollable when ops stack up */}
      <div style={S.body} className="nodrag nowheel">

        {/* ── Filter section ── */}
        {showFilter && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <span style={S.sectionTitle}>Filters</span>
              <button
                style={{ ...S.combinatorPill, background: d.filterCombinator === 'AND' ? '#4f46e5' : '#10b981' }}
                onClick={() => updateNodeData(id, { filterCombinator: d.filterCombinator === 'AND' ? 'OR' : 'AND' })}
                className="nodrag"
                title="Toggle AND / OR combinator"
              >
                {d.filterCombinator}
              </button>
            </div>

            {d.filterOps.length === 0 && (
              <p style={S.emptyHint}>No filters — all records pass through</p>
            )}

            {d.filterOps.map((op, idx) => (
              <FilterRow
                key={op.id}
                op={op}
                fields={fields}
                onChange={p => updateFilterOp(op.id, p)}
                onDelete={() => deleteFilterOp(op.id)}
                showCombinator={idx < d.filterOps.length - 1}
                combinator={d.filterCombinator}
                onToggleCombinator={() => updateNodeData(id, {
                  filterCombinator: d.filterCombinator === 'AND' ? 'OR' : 'AND',
                })}
              />
            ))}

            <button style={S.addBtn} onClick={addFilterOp} className="nodrag">
              ＋ add filter
            </button>
          </section>
        )}

        {/* ── Divider when both modes active ── */}
        {showFilter && showTransform && d.filterOps.length > 0 && (
          <hr style={S.divider} />
        )}

        {/* ── Transform section ── */}
        {showTransform && (
          <section style={S.section}>
            <div style={S.sectionHead}>
              <span style={S.sectionTitle}>Transforms</span>
            </div>

            {d.transformOps.length === 0 && (
              <p style={S.emptyHint}>No transforms — records pass through unchanged</p>
            )}

            {d.transformOps.map(op => (
              <TransformRow
                key={op.id}
                op={op}
                fields={fields}
                onChange={updateTransformOp}
                onDelete={() => deleteTransformOp(op.id)}
              />
            ))}

            <button style={S.addBtn} onClick={addTransformOp} className="nodrag">
              ＋ add transform
            </button>
          </section>
        )}

        {!connected && d.filterOps.length === 0 && d.transformOps.length === 0 && (
          <p style={S.emptyHint}>Connect an upstream node to populate field selectors</p>
        )}
      </div>

      {/* Footer */}
      <div style={S.footer}>
        {d.status === 'success' && (
          <span style={S.preview}>
            {d.inputCount} in → {d.outputCount} out
          </span>
        )}
        <button
          style={{ ...S.runBtn, opacity: !connected ? 0.45 : 1 }}
          disabled={!connected}
          onClick={handleRun}
          className="nodrag"
        >
          ▶  Apply
        </button>
      </div>
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    minWidth:     320,
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
  headerTitle: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  statusBadge: {
    fontSize:     10,
    fontWeight:   600,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  modeTabs: {
    display:         'flex',
    borderBottom:    '1px solid #e5e7eb',
    background:      '#f9fafb',
    borderRadius:    0,
  },
  modeTab: {
    flex:         1,
    border:       'none',
    borderRadius: 0,
    padding:      '5px 0',
    fontSize:     11,
    cursor:       'pointer',
    transition:   'background 0.15s',
  },
  body: {
    padding:       '8px 10px 4px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           6,
    maxHeight:     340,
    overflowY:     'auto' as const,
  },
  section: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           4,
  },
  sectionHead: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   1,
  },
  sectionTitle: {
    fontSize:      10,
    fontWeight:    700,
    color:         '#374151',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  divider: {
    border:    'none',
    borderTop: '1px solid #e5e7eb',
    margin:    '2px 0',
  },
  // ── filter row ──
  filterRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        3,
  },
  combinatorRow: {
    display:        'flex',
    justifyContent: 'center',
    margin:         '1px 0',
  },
  combinatorPill: {
    border:        'none',
    borderRadius:  8,
    color:         '#fff',
    cursor:        'pointer',
    fontSize:      9,
    fontWeight:    700,
    letterSpacing: '0.05em',
    padding:       '1px 8px',
  },
  // ── transform block ──
  transformBlock: {
    border:        '1px solid #e5e7eb',
    borderRadius:  4,
    padding:       '5px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           4,
    background:    '#fafafa',
  },
  transformHeader: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
  },
  transformConfig: {
    display:    'flex',
    alignItems: 'center',
    flexWrap:   'wrap' as const,
    gap:        3,
  },
  multiLineConfig: {
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           3,
    width:         '100%',
  },
  configLine: {
    display:    'flex',
    alignItems: 'center',
    gap:        3,
  },
  // ── shared inputs ──
  sel: {
    fontSize:     11,
    padding:      '2px 3px',
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
  },
  inp: {
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 3,
    background:   '#f9fafb',
    outline:      'none',
    height:       22,
  },
  deleteBtn: {
    background:   'none',
    border:       '1px solid #e5e7eb',
    borderRadius: 3,
    color:        '#9ca3af',
    cursor:       'pointer',
    fontSize:     12,
    lineHeight:   1,
    padding:      '1px 5px',
    flexShrink:   0,
  },
  arrow: {
    color:      '#9ca3af',
    fontSize:   12,
    flexShrink: 0,
  },
  unit: {
    fontSize:   10,
    color:      '#9ca3af',
    flexShrink: 0,
  },
  chkLabel: {
    display:    'flex',
    alignItems: 'center',
    gap:        3,
    fontSize:   10,
    color:      '#6b7280',
    flexShrink: 0,
    cursor:     'pointer',
  },
  addBtn: {
    background:   'none',
    border:       '1px dashed #d1d5db',
    borderRadius: 4,
    color:        '#6b7280',
    cursor:       'pointer',
    fontSize:     10,
    padding:      '3px 8px',
    width:        '100%',
  },
  emptyHint: {
    fontSize:   10,
    color:      '#9ca3af',
    fontStyle:  'italic' as const,
    margin:     '1px 0',
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'flex-end',
    gap:            10,
    borderTop:      '1px solid #f0f0f0',
  },
  preview: {
    fontSize:   11,
    color:      '#15803d',
    fontWeight: 600,
    flex:       1,
  },
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
  inHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  outHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
    top:       13,
  },
}
