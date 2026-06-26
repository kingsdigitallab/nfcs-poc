/**
 * ComparisonReportView — shared presentational component used by both the
 * in-node body and the full-screen ExpandedOutputPanel.
 *
 * Read-only: computes only counts/means/agreement for display.
 * No writes, no charts, no inferential statistics.
 */

import { useState, useMemo } from 'react'
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComparisonReportConfig {
  originalField:   string
  noteField:       string
  responseField:   string
  judgeScoreField: string
  humanScoreField: string
}

interface CriterionStats {
  key:          string
  /** Records that have BOTH a judge AND human value for this criterion. */
  scoredPairs:  number
  agreed:       number
  diverged:     number
  agreePct:     number   // 0-100
  meanJudge:    number | null
  meanHuman:    number | null
  /** Records where judge has a value but human does not. */
  unscoredByHuman: number
}

interface AggregateStats {
  criteria:      CriterionStats[]
  totalRecords:  number
  fullyScored:   number   // records with at least one human score
  unscored:      number   // records with no human scores at all
  mismatchedCriteria: boolean  // judge and human have different criterion keys
}

type FilterMode = 'all' | 'divergent' | 'unscored'

interface FilterState {
  mode:          FilterMode
  criterionKey?: string  // only for divergent mode
}

interface ComparisonReportViewProps {
  records:    UnifiedRecord[] | undefined
  config:     ComparisonReportConfig
  fullscreen?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getScores(record: UnifiedRecord, field: string): Record<string, number> | undefined {
  const v = (record as Record<string, unknown>)[field]
  if (v == null || typeof v !== 'object') return undefined
  const scores = (v as Record<string, unknown>).scores
  if (scores == null || typeof scores !== 'object') return undefined
  return scores as Record<string, number>
}

function getReasons(record: UnifiedRecord, field: string): Record<string, string> | undefined {
  const v = (record as Record<string, unknown>)[field]
  if (v == null || typeof v !== 'object') return undefined
  const reasons = (v as Record<string, unknown>).reasons
  if (reasons == null || typeof reasons !== 'object') return undefined
  return reasons as Record<string, string>
}

function getStringField(record: UnifiedRecord, field: string): string {
  const v = (record as Record<string, unknown>)[field]
  if (v == null) return ''
  if (typeof v === 'string') return v
  return String(v)
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null
  return nums.reduce((a, b) => a + b, 0) / nums.length
}

function fmt2(n: number | null): string {
  if (n === null) return '—'
  return n.toFixed(2)
}

// ── Aggregate computation ─────────────────────────────────────────────────────

function computeAggregate(
  records: UnifiedRecord[],
  config: ComparisonReportConfig,
): AggregateStats {
  const { judgeScoreField, humanScoreField } = config

  // Gather all criterion keys across all records
  const allKeys = new Set<string>()
  const judgeKeys = new Set<string>()
  const humanKeys = new Set<string>()
  for (const r of records) {
    const j = getScores(r, judgeScoreField)
    const h = getScores(r, humanScoreField)
    if (j) for (const k of Object.keys(j)) { allKeys.add(k); judgeKeys.add(k) }
    if (h) for (const k of Object.keys(h)) { allKeys.add(k); humanKeys.add(k) }
  }

  const sortedKeys = [...allKeys].sort()

  // Per-criterion stats
  const criteria: CriterionStats[] = sortedKeys.map(key => {
    const judgeVals: number[] = []
    const humanVals: number[] = []
    let agreed = 0
    let diverged = 0
    let unscoredByHuman = 0

    for (const r of records) {
      const jScores = getScores(r, judgeScoreField)
      const hScores = getScores(r, humanScoreField)
      const jVal = jScores?.[key]
      const hVal = hScores?.[key]

      if (jVal !== undefined && hVal !== undefined) {
        judgeVals.push(jVal)
        humanVals.push(hVal)
        if (jVal === hVal) agreed++; else diverged++
      } else if (jVal !== undefined && hVal === undefined) {
        unscoredByHuman++
      }
    }

    const scoredPairs = agreed + diverged
    return {
      key,
      scoredPairs,
      agreed,
      diverged,
      agreePct: scoredPairs > 0 ? Math.round((agreed / scoredPairs) * 100) : 0,
      meanJudge: mean(judgeVals),
      meanHuman: mean(humanVals),
      unscoredByHuman,
    }
  })

  const unscored = records.filter(r => {
    const h = getScores(r, humanScoreField)
    return !h || Object.keys(h).length === 0
  }).length

  const mismatchedCriteria =
    (judgeKeys.size > 0 || humanKeys.size > 0) &&
    ([...judgeKeys].some(k => !humanKeys.has(k)) || [...humanKeys].some(k => !judgeKeys.has(k)))

  return {
    criteria,
    totalRecords: records.length,
    fullyScored: records.length - unscored,
    unscored,
    mismatchedCriteria,
  }
}

// ── Card sub-components ───────────────────────────────────────────────────────

const MAX_PROSE = 600

function ProseBlock({
  text, label, quiet = false,
}: { text: string; label: string; quiet?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = !expanded && text.length > MAX_PROSE
  return (
    <div style={cs.proseBlock}>
      <div style={cs.proseLabel}>{label}</div>
      <p style={{ ...cs.proseText, ...(quiet ? cs.proseQuiet : {}) }}>
        {truncated ? text.slice(0, MAX_PROSE) + '…' : text}
      </p>
      {text.length > MAX_PROSE && (
        <button style={cs.showMoreBtn} onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

function ScoreStrip({
  criteria, judgeScores, humanScores, judgeReasons, humanReasons,
}: {
  criteria: string[]
  judgeScores: Record<string, number> | undefined
  humanScores: Record<string, number> | undefined
  judgeReasons: Record<string, string> | undefined
  humanReasons: Record<string, string> | undefined
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  if (criteria.length === 0) return null

  return (
    <div style={cs.scoreStrip}>
      <div style={cs.scoreStripHeader}>
        <span style={cs.scoreColLabel} />
        <span style={cs.scoreColLabel}>Judge</span>
        <span style={cs.scoreColLabel}>Human</span>
      </div>
      {criteria.map(key => {
        const jVal = judgeScores?.[key]
        const hVal = humanScores?.[key]
        const agree = jVal !== undefined && hVal !== undefined && jVal === hVal
        const diverge = jVal !== undefined && hVal !== undefined && jVal !== hVal
        const jReason = judgeReasons?.[`${key}_reason`] ?? judgeReasons?.[key] ?? ''
        const hReason = humanReasons?.[key] ?? ''
        const hasReason = jReason || hReason
        return (
          <div key={key}>
            <div style={cs.scoreRow}>
              <span style={cs.scoreRowKey}>{key}</span>
              <span style={cs.scoreValCell}>
                {jVal !== undefined ? jVal : <span style={cs.noScore}>—</span>}
              </span>
              <span style={{ ...cs.scoreValCell, ...(agree ? cs.scoreAgree : diverge ? cs.scoreDiverge : {}) }}>
                {hVal !== undefined
                  ? hVal
                  : <span style={cs.noScore}>not scored</span>}
              </span>
              {hasReason && (
                <button style={cs.reasonToggle} onClick={() => setOpenKey(openKey === key ? null : key)}
                  title="Show reasons">
                  {openKey === key ? '▴' : '▾'}
                </button>
              )}
            </div>
            {openKey === key && hasReason && (
              <div style={cs.reasonBlock}>
                {jReason && <div style={cs.reasonRow}><span style={cs.reasonSource}>Judge:</span> {jReason}</div>}
                {hReason && <div style={cs.reasonRow}><span style={cs.reasonSource}>Human:</span> {hReason}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AgreementCue({
  criteria, judgeScores, humanScores,
}: {
  criteria: string[]
  judgeScores: Record<string, number> | undefined
  humanScores: Record<string, number> | undefined
}) {
  if (!humanScores || Object.keys(humanScores).length === 0) {
    return <span style={cs.cueUnscored}>○ not scored</span>
  }
  const pairs = criteria.filter(k => judgeScores?.[k] !== undefined && humanScores?.[k] !== undefined)
  if (pairs.length === 0) return null
  const diverged = pairs.filter(k => judgeScores![k] !== humanScores[k]).length
  if (diverged === 0) return <span style={cs.cueAgree}>✓ agree</span>
  return (
    <span style={cs.cueDiverge}>
      ⚠ {diverged} diverge{diverged > 1 ? 's' : ''}
    </span>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ComparisonReportView({ records, config, fullscreen = false }: ComparisonReportViewProps) {
  const [filter, setFilter] = useState<FilterState>({ mode: 'all' })

  const stats = useMemo<AggregateStats | null>(
    () => (records && records.length > 0 ? computeAggregate(records, config) : null),
    [records, config],
  )

  const criteriaKeys = stats?.criteria.map(c => c.key) ?? []

  const filteredRecords = useMemo(() => {
    if (!records) return []
    if (filter.mode === 'all') return records
    if (filter.mode === 'unscored') {
      return records.filter(r => {
        const h = getScores(r, config.humanScoreField)
        return !h || Object.keys(h).length === 0
      })
    }
    // divergent — per-criterion or overall
    return records.filter(r => {
      const j = getScores(r, config.judgeScoreField)
      const h = getScores(r, config.humanScoreField)
      if (!j || !h) return false
      const keysToCheck = filter.criterionKey ? [filter.criterionKey] : criteriaKeys
      return keysToCheck.some(k =>
        j[k] !== undefined && h[k] !== undefined && j[k] !== h[k]
      )
    })
  }, [records, filter, criteriaKeys, config])

  if (!records || records.length === 0) {
    return (
      <div style={cv.empty}>
        {!records ? 'Run upstream nodes to see results' : 'No records'}
      </div>
    )
  }

  const configMissing =
    !config.judgeScoreField && !config.humanScoreField &&
    !config.originalField && !config.responseField

  if (configMissing) {
    return (
      <div style={cv.empty}>
        Map roles in the configuration panel above to display the report.
      </div>
    )
  }

  return (
    <div style={{ ...cv.root, ...(fullscreen ? cv.rootFullscreen : {}) }}>

      {/* ── Aggregate summary panel ─────────────────────────────────────────── */}
      {stats && (
        <div style={cv.summaryPanel}>
          <div style={cv.summaryHeader}>
            <span style={cv.summaryTitle}>Summary</span>
            <span style={cv.summaryMeta}>
              {stats.fullyScored}/{stats.totalRecords} records scored
              {stats.unscored > 0 && ` · ${stats.unscored} unscored`}
            </span>
            {stats.mismatchedCriteria && (
              <span style={cv.mismatchWarning} title="Judge and human criteria keys differ — agreement is computed only for matching keys">
                ⚠ criteria mismatch
              </span>
            )}
          </div>

          {stats.criteria.length > 0 ? (
            <table style={cv.summaryTable}>
              <thead>
                <tr>
                  <th style={cv.th}>Criterion</th>
                  <th style={cv.th}>Agreement</th>
                  <th style={cv.th}>Mean judge</th>
                  <th style={cv.th}>Mean human</th>
                  <th style={cv.th}>Diverged</th>
                  <th style={cv.th}>Unscored</th>
                </tr>
              </thead>
              <tbody>
                {stats.criteria.map(c => (
                  <tr key={c.key}>
                    <td style={cv.td}><code style={cv.criterionCode}>{c.key}</code></td>
                    <td style={cv.td}>
                      {c.scoredPairs > 0
                        ? `${c.agreed}/${c.scoredPairs} (${c.agreePct}%)`
                        : '—'}
                    </td>
                    <td style={cv.td}>{fmt2(c.meanJudge)}</td>
                    <td style={cv.td}>{fmt2(c.meanHuman)}</td>
                    <td style={cv.td}>
                      {c.diverged > 0 ? (
                        <button
                          style={cv.divergedBtn}
                          onClick={() => setFilter({ mode: 'divergent', criterionKey: c.key })}
                          title={`Filter to ${c.diverged} divergent records on ${c.key}`}
                        >
                          {c.diverged}
                        </button>
                      ) : (
                        <span style={{ color: '#6b7280' }}>0</span>
                      )}
                    </td>
                    <td style={cv.td}>
                      {c.unscoredByHuman > 0
                        ? <span style={{ color: '#9ca3af' }}>{c.unscoredByHuman}</span>
                        : '0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={cv.noScoresHint}>
              No judge or human scores detected. Map the judgeScore and humanScore roles above.
            </div>
          )}

          {/* Filter controls */}
          <div style={cv.filterBar}>
            <span style={cv.filterLabel}>Show:</span>
            <button
              style={{ ...cv.filterBtn, ...(filter.mode === 'all' ? cv.filterBtnActive : {}) }}
              onClick={() => setFilter({ mode: 'all' })}>
              All ({records.length})
            </button>
            <button
              style={{ ...cv.filterBtn, ...(filter.mode === 'divergent' && !filter.criterionKey ? cv.filterBtnActive : {}) }}
              onClick={() => setFilter({ mode: 'divergent' })}>
              Divergent
            </button>
            <button
              style={{ ...cv.filterBtn, ...(filter.mode === 'unscored' ? cv.filterBtnActive : {}) }}
              onClick={() => setFilter({ mode: 'unscored' })}>
              Unscored ({stats.unscored})
            </button>
            {filter.mode !== 'all' && (
              <span style={cv.filterActive}>
                {filteredRecords.length} record{filteredRecords.length !== 1 ? 's' : ''}
                {filter.criterionKey && ` · ${filter.criterionKey}`}
                <button style={cv.clearFilterBtn} onClick={() => setFilter({ mode: 'all' })}>
                  ✕ clear
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Precondition note */}
      <div style={cv.preconditionNote}>
        Agreement maths is only meaningful when judge and human share the same criteria keys and scale.
        Configure the human-score QuickNote to mirror the EvaluatorNode's rubric criteria.
      </div>

      {/* ── Cards ────────────────────────────────────────────────────────────── */}
      <div style={cv.cardStack}>
        {filteredRecords.map((record, idx) => {
          const r = record as Record<string, unknown>
          const original = config.originalField ? getStringField(record, config.originalField) : ''
          const note     = config.noteField     ? getStringField(record, config.noteField)     : ''
          const response = config.responseField ? getStringField(record, config.responseField) : ''
          const jScores  = config.judgeScoreField ? getScores(record, config.judgeScoreField) : undefined
          const hScores  = config.humanScoreField ? getScores(record, config.humanScoreField) : undefined
          const jReasons = config.judgeScoreField ? getReasons(record, config.judgeScoreField) : undefined
          const hReasons = config.humanScoreField ? getReasons(record, config.humanScoreField) : undefined
          const recLabel = String(r.title ?? r.filename ?? r.id ?? `Record ${idx + 1}`)

          return (
            <div key={String(r.id ?? idx)} style={cv.card}>
              <div style={cv.cardTitle}>
                <span style={cv.cardIndex}>#{idx + 1}</span>
                <span style={cv.cardLabel}>{recLabel}</span>
                <AgreementCue criteria={criteriaKeys} judgeScores={jScores} humanScores={hScores} />
              </div>

              {original && <ProseBlock text={original} label="Source" />}
              {note      && <ProseBlock text={note}     label="Gold note" quiet />}
              {response  && <ProseBlock text={response} label="Model response" />}

              {criteriaKeys.length > 0 && (
                <ScoreStrip
                  criteria={criteriaKeys}
                  judgeScores={jScores}
                  humanScores={hScores}
                  judgeReasons={jReasons}
                  humanReasons={hReasons}
                />
              )}
            </div>
          )
        })}
        {filteredRecords.length === 0 && (
          <div style={cv.empty}>No records match the current filter.</div>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const REPORT_HEADER = '#3730a3'

// Card/strip sub-component styles
const cs = {
  proseBlock: { marginBottom: 8 },
  proseLabel: {
    fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase' as const,
    letterSpacing: '0.05em', marginBottom: 2,
  },
  proseText: {
    margin: 0, fontSize: 13, lineHeight: 1.65, color: '#111827',
    maxWidth: 680, whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const,
  },
  proseQuiet: { color: '#6b7280' },
  showMoreBtn: {
    background: 'none', border: 'none', color: '#6366f1', fontSize: 11,
    cursor: 'pointer', padding: 0, marginTop: 2,
  },
  scoreStrip: {
    marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden',
  },
  scoreStripHeader: {
    display: 'grid', gridTemplateColumns: '80px 1fr 1fr',
    background: '#f8fafc', padding: '4px 8px', borderBottom: '1px solid #e5e7eb',
  },
  scoreColLabel: { fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' as const },
  scoreRow: {
    display: 'grid', gridTemplateColumns: '80px 1fr 1fr auto',
    padding: '5px 8px', alignItems: 'center', borderBottom: '1px solid #f3f4f6',
  },
  scoreRowKey: { fontSize: 11, fontWeight: 600, color: '#374151', fontFamily: 'monospace' },
  scoreValCell: { fontSize: 13, fontWeight: 700, color: '#374151', fontFamily: 'monospace' },
  scoreAgree:   { color: '#059669' },
  scoreDiverge: { color: '#dc2626' },
  noScore: { fontSize: 10, color: '#9ca3af', fontWeight: 400, fontFamily: 'system-ui' },
  reasonToggle: {
    background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer',
    fontSize: 11, padding: '0 4px',
  },
  reasonBlock: { background: '#fafafa', padding: '6px 8px', borderBottom: '1px solid #f3f4f6' },
  reasonRow: { fontSize: 11, color: '#374151', lineHeight: 1.5, marginBottom: 3 },
  reasonSource: { fontWeight: 700, color: '#6b7280' },
  cueAgree: {
    fontSize: 10, fontWeight: 600, color: '#059669', background: '#d1fae5',
    padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap' as const,
  },
  cueDiverge: {
    fontSize: 10, fontWeight: 600, color: '#b91c1c', background: '#fee2e2',
    padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap' as const,
  },
  cueUnscored: {
    fontSize: 10, fontWeight: 500, color: '#9ca3af', background: '#f3f4f6',
    padding: '2px 7px', borderRadius: 10, whiteSpace: 'nowrap' as const,
  },
}

// Container / layout styles
const cv = {
  root: {
    display: 'flex', flexDirection: 'column' as const, gap: 0,
    height: '100%', overflowY: 'auto' as const,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  rootFullscreen: {},
  empty: {
    padding: '24px 20px', color: '#9ca3af', fontSize: 12,
    fontStyle: 'italic' as const, textAlign: 'center' as const,
  },
  summaryPanel: {
    background: '#f8fafc', borderBottom: '2px solid #e5e7eb',
    padding: '12px 16px', flexShrink: 0,
  },
  summaryHeader: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' as const,
  },
  summaryTitle: { fontSize: 13, fontWeight: 700, color: '#1e1b4b' },
  summaryMeta: { fontSize: 11, color: '#6b7280' },
  mismatchWarning: {
    fontSize: 10, fontWeight: 600, color: '#b45309', background: '#fef3c7',
    padding: '2px 7px', borderRadius: 4, cursor: 'help',
  },
  summaryTable: {
    width: '100%', borderCollapse: 'collapse' as const, fontSize: 11, marginBottom: 8,
  },
  th: {
    textAlign: 'left' as const, padding: '4px 8px', background: '#f1f5f9',
    fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb',
    whiteSpace: 'nowrap' as const,
  },
  td: { padding: '4px 8px', borderBottom: '1px solid #f3f4f6', color: '#374151' },
  criterionCode: { fontSize: 10, background: '#ede9fe', color: '#3730a3', padding: '1px 4px', borderRadius: 3 },
  divergedBtn: {
    background: '#fee2e2', border: '1px solid #fca5a5', color: '#b91c1c',
    fontSize: 11, fontWeight: 700, padding: '1px 8px', borderRadius: 4,
    cursor: 'pointer', textDecoration: 'underline',
  },
  noScoresHint: { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' as const, padding: '4px 0' },
  filterBar: {
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const, marginTop: 8,
  },
  filterLabel: { fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const },
  filterBtn: {
    fontSize: 11, padding: '3px 10px', borderRadius: 4,
    border: '1px solid #d1d5db', background: '#fff', color: '#374151',
    cursor: 'pointer',
  },
  filterBtnActive: {
    background: REPORT_HEADER, color: '#fff', borderColor: REPORT_HEADER,
  },
  filterActive: {
    fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4,
  },
  clearFilterBtn: {
    background: 'none', border: '1px solid #d1d5db', color: '#6b7280',
    fontSize: 10, padding: '1px 6px', borderRadius: 3, cursor: 'pointer', marginLeft: 4,
  },
  preconditionNote: {
    fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const,
    padding: '6px 16px', background: '#fafafa', borderBottom: '1px solid #f1f5f9',
    flexShrink: 0,
  },
  cardStack: { padding: '12px 16px', display: 'flex', flexDirection: 'column' as const, gap: 16 },
  card: {
    background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 8,
    padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  },
  cardTitle: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
    flexWrap: 'wrap' as const,
  },
  cardIndex: {
    fontSize: 10, fontWeight: 700, color: '#9ca3af', fontFamily: 'monospace',
  },
  cardLabel: {
    fontSize: 12, fontWeight: 600, color: '#374151', flex: 1,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
}
