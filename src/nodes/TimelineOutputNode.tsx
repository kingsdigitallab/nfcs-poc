/**
 * TimelineViewNode — SVG timeline visualising records at year resolution,
 * with draggable start/end filter handles and a filtered output.
 *
 * Drag handles on the axis to set a date range; records outside the range are
 * excluded from the output handle. Downstream nodes receive filtered records.
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { setNodeResults } from '../store/resultsStore'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { candidateFields } from '../utils/reconciliationService'

// ─── source appearance ────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<string, string> = {
  gbif:      '#16a34a',
  ads:       '#c2410c',
  llds:      '#b45309',
  mds:       '#1d4ed8',
  europeana: '#2563eb',
}
const FALLBACK_COLOR = '#6366f1'

const SOURCE_SHAPES: Record<string, string> = {
  gbif:      'circle',
  ads:       'square',
  llds:      'triangle',
  mds:       'diamond',
  europeana: 'circle',
}

const SHAPE_GLYPHS: Record<string, string> = {
  circle:   '●',
  square:   '■',
  triangle: '▲',
  diamond:  '◆',
}

function sourceColor(src: string | undefined): string {
  return SOURCE_COLORS[src ?? ''] ?? FALLBACK_COLOR
}
function sourceShape(src: string | undefined): string {
  return SOURCE_SHAPES[src ?? ''] ?? 'circle'
}

// ─── SVG shape component ──────────────────────────────────────────────────────

interface ShapeProps {
  shape:        string
  cx:           number
  cy:           number
  r:            number
  color:        string
  onMouseEnter: React.MouseEventHandler
  onMouseLeave: React.MouseEventHandler
}

function Marker({ shape, cx, cy, r, color, onMouseEnter, onMouseLeave }: ShapeProps) {
  const common = {
    fill:        color,
    stroke:      '#fff',
    strokeWidth: 1.5 as number,
    style:       { cursor: 'pointer' } as React.CSSProperties,
    onMouseEnter,
    onMouseLeave,
  }
  if (shape === 'square') {
    return <rect {...common} x={cx - r} y={cy - r} width={r * 2} height={r * 2} />
  }
  if (shape === 'triangle') {
    const pts = `${cx},${cy - r}  ${cx + r * 1.1},${cy + r}  ${cx - r * 1.1},${cy + r}`
    return <polygon {...common} points={pts} />
  }
  if (shape === 'diamond') {
    const pts = `${cx},${cy - r * 1.2}  ${cx + r},${cy}  ${cx},${cy + r * 1.2}  ${cx - r},${cy}`
    return <polygon {...common} points={pts} />
  }
  return <circle {...common} cx={cx} cy={cy} r={r} />
}

// ─── date → year ──────────────────────────────────────────────────────────────

function toYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (/^-\d+$/.test(s)) return parseInt(s, 10)
  const bce = /(\d+)\s*(?:BCE|B\.C\.E\.?|BC|B\.C\.)/i.exec(s)
  if (bce) return -parseInt(bce[1], 10)
  const m = /\b(\d{4})\b/.exec(s)
  if (m) { const n = parseInt(m[1], 10); if (n >= 0 && n <= 2200) return n }
  const m3 = /\b(\d{3})\b/.exec(s)
  if (m3) return parseInt(m3[1], 10)
  return null
}

function fmtYear(y: number): string {
  return y < 0 ? `${-y} BCE` : String(y)
}

// ─── tick helper ─────────────────────────────────────────────────────────────

function smartTicks(min: number, max: number, targetCount: number): number[] {
  const range    = Math.max(max - min, 1)
  const raw      = range / targetCount
  const nice     = [1, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 2000, 5000]
  const interval = nice.find(i => i >= raw) ?? 5000
  const start    = Math.ceil(min / interval) * interval
  const ticks: number[] = []
  for (let t = start; t <= max + 1; t += interval) ticks.push(t)
  return ticks
}

// ─── layout constants ─────────────────────────────────────────────────────────

const DEFAULT_W  = 520
const PAD_L      = 14
const PAD_R      = 20
const PAD_TOP    = 14   // extra top space for handle labels
const PAD_BOT    = 38   // extra bottom space for handle knobs + labels
const DOT_R      = 5
const DOT_GAP    = 13
const MAX_STACK  = 10

// ─── data type ────────────────────────────────────────────────────────────────

export interface TimelineOutputNodeData {
  fitToRange:  boolean
  filterStart: number | null
  filterEnd:   number | null
  filterCount?: number
  totalCount?:  number
  dateField?:  string
  [key: string]: unknown
}

// ─── component ────────────────────────────────────────────────────────────────

interface HoverState {
  record: UnifiedRecord
  svgX:   number
  svgY:   number
}

export function TimelineViewNode({ id, data, width: measuredWidth, selected }: NodeProps) {
  const { updateNodeData }                            = useReactFlow()
  const { records, connected, status }  = useUpstreamRecords(id)

  const [hovered,       setHovered]      = useState<HoverState | null>(null)
  const [dragging,      setDragging]     = useState<'start' | 'end' | null>(null)
  const [dragYear,      setDragYear]     = useState<number>(0)

  const d          = data as TimelineOutputNodeData
  const savedStart = d.filterStart ?? null
  const savedEnd   = d.filterEnd   ?? null

  const [localStartTxt, setLocalStartTxt] = useState(() => savedStart !== null ? String(savedStart) : '')
  const [localEndTxt,   setLocalEndTxt]   = useState(() => savedEnd   !== null ? String(savedEnd)   : '')

  const scrollRef      = useRef<HTMLDivElement>(null)
  const svgRef         = useRef<SVGSVGElement>(null)
  const dismissTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs holding latest values for global drag handlers (avoids stale closures)
  const svgWRef        = useRef(0)
  const minYearRef     = useRef(0)
  const yearRangeRef   = useRef(1)
  const savedStartRef  = useRef(savedStart)
  const savedEndRef    = useRef(savedEnd)

  useEffect(() => { savedStartRef.current = savedStart }, [savedStart])
  useEffect(() => { savedEndRef.current   = savedEnd   }, [savedEnd])

  const fitToRange = d.fitToRange ?? false
  const nodeWidth  = measuredWidth ?? DEFAULT_W
  const dateField  = (d.dateField ?? '') as string

  const availableFields = useMemo(
    () => records?.length ? candidateFields(records as Record<string, unknown>[], true) : [],
    [records],
  )

  // Resolve year from a record using the selected dateField or default date/eventDate logic
  const recordYear = useCallback((r: UnifiedRecord): number | null => {
    if (dateField) {
      const raw = dateField.includes('.')
        ? dateField.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], r)
        : (r as Record<string, unknown>)[dateField]
      return toYear(raw as string | undefined)
    }
    // gbif.eventDate fallback: the adapter mirrors it into `date`, but records
    // filtered/transformed upstream may carry only the namespaced original.
    return toYear(r.date as string | undefined)
      ?? toYear((r.gbif as Record<string, unknown> | undefined)?.eventDate as string | undefined)
  }, [dateField])

  const scheduleHide = useCallback(() => {
    dismissTimer.current = setTimeout(() => setHovered(null), 180)
  }, [])
  const cancelHide = useCallback(() => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null }
  }, [])

  // ── timeline items & metrics ────────────────────────────────────────────────
  const { items, minYear, maxYear, yearMap, bySource, noDateCount } = useMemo(() => {
    const items:    { record: UnifiedRecord; year: number }[] = []
    const bySource: Record<string, number>                    = {}
    let noDateCount = 0

    for (const r of records ?? []) {
      const year = recordYear(r)
      if (year === null) { noDateCount++; continue }
      items.push({ record: r, year })
      const src = r._source ?? 'unknown'
      bySource[src] = (bySource[src] ?? 0) + 1
    }
    items.sort((a, b) => a.year - b.year)

    const years   = items.map(i => i.year)
    const minYear = years.length ? Math.min(...years) : new Date().getFullYear() - 10
    const maxYear = years.length ? Math.max(...years) : new Date().getFullYear()

    const yearMap = new Map<number, typeof items>()
    for (const item of items) {
      if (!yearMap.has(item.year)) yearMap.set(item.year, [])
      yearMap.get(item.year)!.push(item)
    }
    return { items, minYear, maxYear, yearMap, bySource, noDateCount }
  }, [records, recordYear])

  // ── SVG geometry ──────────────────────────────────────────────────────────
  const yearRange   = Math.max(maxYear - minYear, 1)
  const autoPxPerYear = yearRange <= 30  ? 14
                      : yearRange <= 100 ? 6
                      : yearRange <= 300 ? 3
                      : yearRange <= 800 ? 2
                      : 1
  const plotW = nodeWidth - 20
  const svgW  = fitToRange
    ? Math.max(plotW, PAD_L + PAD_R + 20)
    : Math.max(plotW, yearRange * autoPxPerYear + PAD_L + PAD_R)

  const maxStack  = Math.max(0, ...Array.from(yearMap.values()).map(v => v.length))
  const stackRows = Math.min(maxStack, MAX_STACK)
  const svgH      = PAD_TOP + stackRows * DOT_GAP + DOT_R * 2 + PAD_BOT
  const axisY     = svgH - PAD_BOT

  // Keep refs current for drag handlers
  useEffect(() => { svgWRef.current = svgW },        [svgW])
  useEffect(() => { minYearRef.current = minYear },   [minYear])
  useEffect(() => { yearRangeRef.current = yearRange }, [yearRange])

  function yearToX(year: number): number {
    return PAD_L + ((year - minYear) / yearRange) * (svgW - PAD_L - PAD_R)
  }

  const ticks = useMemo(
    () => smartTicks(minYear, maxYear, Math.min(8, Math.max(2, Math.floor((svgW - PAD_L - PAD_R) / 65)))),
    [minYear, maxYear, svgW],
  )

  // ── filter state ──────────────────────────────────────────────────────────
  // Live drag position overrides saved value while dragging
  const effectiveStart = dragging === 'start' ? dragYear : savedStart
  const effectiveEnd   = dragging === 'end'   ? dragYear : savedEnd

  // Normalise for shading / filtering
  const lo = effectiveStart !== null && effectiveEnd !== null ? Math.min(effectiveStart, effectiveEnd) : effectiveStart
  const hi = effectiveStart !== null && effectiveEnd !== null ? Math.max(effectiveStart, effectiveEnd) : effectiveEnd

  // ── apply filter → write to resultsStore ─────────────────────────────────
  const applyRef = useRef<(s: number | null, e: number | null) => void>(() => {/* */})
  const applyFilterValues = useCallback((start: number | null, end: number | null) => {
    const upstream = (records ?? []) as UnifiedRecord[]
    const slo = start !== null && end !== null ? Math.min(start, end) : start
    const shi = start !== null && end !== null ? Math.max(start, end) : end

    const filtered = (slo === null && shi === null)
      ? upstream
      : upstream.filter(r => {
          const year = recordYear(r) ?? null
          if (year === null) return false
          if (slo !== null && year < slo) return false
          if (shi !== null && year > shi) return false
          return true
        })

    const version = setNodeResults(id, filtered as Record<string, unknown>[])
    updateNodeData(id, {
      filterStart:    start,
      filterEnd:      end,
      filterCount:    filtered.length,
      totalCount:     upstream.length,
      resultsVersion: version,
    })
    setLocalStartTxt(start !== null ? String(start) : '')
    setLocalEndTxt(end   !== null ? String(end)   : '')
  }, [records, id, updateNodeData, recordYear])

  useEffect(() => { applyRef.current = applyFilterValues }, [applyFilterValues])

  // Re-apply active filter when the date field changes so output stays consistent
  useEffect(() => { applyRef.current(savedStartRef.current, savedEndRef.current) }, [dateField]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-initialise range handles to full data extent when data first arrives.
  // Uses refs (not state) to avoid stale closures; runs only when data range changes.
  useEffect(() => {
    if (items.length > 0 && savedStartRef.current === null && savedEndRef.current === null) {
      applyRef.current(minYear, maxYear)
    }
  }, [items.length, minYear, maxYear]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── global drag listeners ─────────────────────────────────────────────────
  useEffect(() => {
    if (!dragging) return

    function getYear(clientX: number): number {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return 0
      const x       = clientX - rect.left
      const clipped = Math.max(PAD_L, Math.min(svgWRef.current - PAD_R, x))
      return Math.round(minYearRef.current + ((clipped - PAD_L) / Math.max(svgWRef.current - PAD_L - PAD_R, 1)) * yearRangeRef.current)
    }

    function onMove(e: MouseEvent) { setDragYear(getYear(e.clientX)) }

    function onUp(e: MouseEvent) {
      const year     = getYear(e.clientX)
      const newStart = dragging === 'start' ? year : savedStartRef.current
      const newEnd   = dragging === 'end'   ? year : savedEndRef.current
      setDragging(null)
      applyRef.current(newStart, newEnd)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [dragging])

  // Keep text inputs in sync while dragging
  useEffect(() => {
    if (dragging === 'start') setLocalStartTxt(String(dragYear))
    if (dragging === 'end')   setLocalEndTxt(String(dragYear))
  }, [dragging, dragYear])

  // ── header note ──────────────────────────────────────────────────────────
  const uniqueYears = new Set(items.map(i => i.year)).size
  const headerNote  = !connected
    ? 'Connect a node'
    : status === 'loading'
      ? 'Loading…'
      : items.length > 0
        ? `${items.length} item${items.length !== 1 ? 's' : ''} · ${uniqueYears} yr${uniqueYears !== 1 ? 's' : ''}${noDateCount > 0 ? ` (${noDateCount} undated)` : ''}`
        : records
          ? `No parseable dates${noDateCount > 0 ? ` (${noDateCount} undated)` : ''}`
          : 'Run upstream node'

  const filterActive  = savedStart !== null || savedEnd !== null
  const filteredCount = d.filterCount ?? 0

  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 300 }}>
      <NodeResizer minWidth={300} maxWidth={1600} minHeight={60} isVisible={selected} />
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />
      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    <div style={{ ...styles.card, width: '100%' }}>

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.title}>Timeline View</span>
        <div style={styles.headerRight}>
          <button
            style={{
              ...styles.fitBtn,
              background:  fitToRange ? '#3b82f6' : 'rgba(255,255,255,0.12)',
              borderColor: fitToRange ? '#3b82f6' : 'rgba(255,255,255,0.25)',
              color:       fitToRange ? '#fff'    : '#94a3b8',
            }}
            onClick={() => updateNodeData(id, { fitToRange: !fitToRange })}
            className="nodrag"
            title={fitToRange ? 'Fit mode ON — click to restore auto-scale' : 'Compress range into visible width'}
          >
            ⇤⇥ fit
          </button>
          <span style={styles.badge}>{headerNote}</span>
        </div>
      </div>

      {/* ── Chart ── */}
      <div
        ref={scrollRef}
        className="nodrag nowheel"
        style={{ ...styles.scrollContainer, overflowX: fitToRange ? 'hidden' : 'auto' }}
        onMouseLeave={() => { cancelHide(); setHovered(null) }}
      >
        <svg
          ref={svgRef}
          width={svgW} height={svgH}
          style={{ display: 'block', cursor: dragging ? 'ew-resize' : 'default', userSelect: 'none' }}
        >
          {/* Shaded filter region */}
          {lo !== null && hi !== null && (
            <rect
              x={yearToX(lo)} y={PAD_TOP}
              width={Math.max(0, yearToX(hi) - yearToX(lo))}
              height={axisY - PAD_TOP}
              fill="rgba(59,130,246,0.07)"
              stroke="none"
              pointerEvents="none"
            />
          )}

          {/* X-axis baseline */}
          <line x1={PAD_L} y1={axisY} x2={svgW - PAD_R} y2={axisY} stroke="#e5e7eb" strokeWidth={1} />

          {/* Year ticks + labels */}
          {ticks.map(year => {
            const x = yearToX(year)
            return (
              <g key={year}>
                <line x1={x} y1={axisY} x2={x} y2={axisY + 5} stroke="#d1d5db" strokeWidth={1} />
                <text x={x} y={axisY + 16} textAnchor="middle" fontSize={9} fill="#9ca3af">
                  {year < 0 ? `${-year} BCE` : String(year)}
                </text>
              </g>
            )
          })}

          {/* Markers */}
          {Array.from(yearMap.entries()).map(([year, yearItems]) => {
            const x = Math.round(yearToX(year))
            return yearItems.slice(0, MAX_STACK).map((item, stackIdx) => {
              const y   = axisY - DOT_R - stackIdx * DOT_GAP
              const clr = sourceColor(item.record._source as string | undefined)
              const shp = sourceShape(item.record._source as string | undefined)
              return (
                <Marker
                  key={item.record._id as string ?? `${year}-${stackIdx}`}
                  shape={shp} cx={x} cy={y} r={DOT_R} color={clr}
                  onMouseEnter={() => { cancelHide(); setHovered({ record: item.record, svgX: x, svgY: y }) }}
                  onMouseLeave={scheduleHide}
                />
              )
            })
          })}

          {/* Overflow labels */}
          {Array.from(yearMap.entries()).filter(([, v]) => v.length > MAX_STACK).map(([year, v]) => {
            const x = Math.round(yearToX(year))
            const y = axisY - DOT_R - MAX_STACK * DOT_GAP - 4
            return (
              <text key={`ovf-${year}`} x={x} y={y} textAnchor="middle" fontSize={8} fill="#6b7280">
                +{v.length - MAX_STACK}
              </text>
            )
          })}

          {/* ── Start handle ── */}
          {effectiveStart !== null && (() => {
            const x = yearToX(effectiveStart)
            return (
              <g key="start-handle">
                <line x1={x} y1={PAD_TOP} x2={x} y2={axisY} stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="3,2" pointerEvents="none" />
                {/* top label */}
                <text x={x} y={PAD_TOP - 2} textAnchor="middle" fontSize={8} fill="#3b82f6" fontWeight={700} pointerEvents="none">
                  {fmtYear(effectiveStart)}
                </text>
                {/* drag knob — below axis */}
                <rect
                  x={x - 6} y={axisY + 3}
                  width={12} height={10} rx={2}
                  fill="#3b82f6" stroke="#fff" strokeWidth={1.5}
                  style={{ cursor: 'ew-resize' }}
                  onMouseDown={e => { e.stopPropagation(); setDragging('start'); setDragYear(effectiveStart) }}
                />
                <text x={x} y={axisY + 26} textAnchor="middle" fontSize={7} fill="#3b82f6" pointerEvents="none">
                  from
                </text>
              </g>
            )
          })()}

          {/* ── End handle ── */}
          {effectiveEnd !== null && (() => {
            const x = yearToX(effectiveEnd)
            return (
              <g key="end-handle">
                <line x1={x} y1={PAD_TOP} x2={x} y2={axisY} stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3,2" pointerEvents="none" />
                <text x={x} y={PAD_TOP - 2} textAnchor="middle" fontSize={8} fill="#ef4444" fontWeight={700} pointerEvents="none">
                  {fmtYear(effectiveEnd)}
                </text>
                <rect
                  x={x - 6} y={axisY + 3}
                  width={12} height={10} rx={2}
                  fill="#ef4444" stroke="#fff" strokeWidth={1.5}
                  style={{ cursor: 'ew-resize' }}
                  onMouseDown={e => { e.stopPropagation(); setDragging('end'); setDragYear(effectiveEnd) }}
                />
                <text x={x} y={axisY + 26} textAnchor="middle" fontSize={7} fill="#ef4444" pointerEvents="none">
                  to
                </text>
              </g>
            )
          })()}
        </svg>

        {/* Hover tooltip */}
        {hovered && (() => {
          const scrollLeft = scrollRef.current?.scrollLeft ?? 0
          const visibleW   = scrollRef.current?.clientWidth ?? plotW
          const visibleX   = hovered.svgX - scrollLeft
          const tipLeft    = Math.max(4, Math.min(visibleX + 10, visibleW - 224))
          const tipTop     = Math.max(4, hovered.svgY - 72)
          const r          = hovered.record
          const g          = r.gbif as Record<string, unknown> | undefined
          const title      = String(r.title ?? g?.scientificName ?? '(no title)').slice(0, 60)
          const date       = String(r.date ?? g?.eventDate ?? '')
          const glyph      = SHAPE_GLYPHS[sourceShape(r._source as string | undefined)] ?? '●'
          return (
            <div
              style={{ ...styles.tooltip, left: tipLeft, top: tipTop }}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
            >
              <div style={styles.tooltipTitle}>{title}{title.length >= 60 ? '…' : ''}</div>
              <div style={styles.tooltipMeta}>
                <span style={{ color: sourceColor(r._source as string | undefined) }}>{glyph} {r._source ?? ''}</span>
                {date ? ` · ${date}` : ''}
              </div>
              {r._sourceUrl && (
                <a href={r._sourceUrl as string} target="_blank" rel="noopener noreferrer"
                  style={styles.tooltipLink} onClick={e => e.stopPropagation()}>
                  View record →
                </a>
              )}
            </div>
          )
        })()}
      </div>

      {/* ── Filter bar ── */}
      <div style={styles.filterBar} className="nodrag">
        <select
          style={styles.dateSelect}
          value={dateField}
          onChange={e => updateNodeData(id, { dateField: e.target.value })}
          className="nodrag"
          title="Field used as the date source (blank = auto: date / gbif.eventDate)"
        >
          <option value="">date: auto</option>
          {availableFields.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <span style={styles.filterLabel}>Filter</span>
        <input
          style={styles.yearInput}
          type="number"
          placeholder="from"
          value={localStartTxt}
          onChange={e => setLocalStartTxt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilterValues(localStartTxt ? parseInt(localStartTxt, 10) : null, localEndTxt ? parseInt(localEndTxt, 10) : null)}
          title="Start year (drag blue handle or type)"
        />
        <span style={styles.filterSep}>–</span>
        <input
          style={styles.yearInput}
          type="number"
          placeholder="to"
          value={localEndTxt}
          onChange={e => setLocalEndTxt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && applyFilterValues(localStartTxt ? parseInt(localStartTxt, 10) : null, localEndTxt ? parseInt(localEndTxt, 10) : null)}
          title="End year (drag red handle or type)"
        />
        <button
          style={styles.applyBtn}
          onClick={() => applyFilterValues(
            localStartTxt ? parseInt(localStartTxt, 10) : null,
            localEndTxt   ? parseInt(localEndTxt,   10) : null,
          )}
          title="Apply date filter and send filtered records to output"
        >
          ▶
        </button>
        {filterActive && (
          <>
            <span style={styles.filterCount}>
              {filteredCount} out
            </span>
            <button
              style={styles.clearBtn}
              onClick={() => applyFilterValues(null, null)}
              title="Clear filter — pass through all records"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* ── Legend ── */}
      {Object.keys(bySource).length > 0 && (
        <div style={styles.legend}>
          {Object.entries(bySource).map(([src, n]) => {
            const glyph = SHAPE_GLYPHS[sourceShape(src)] ?? '●'
            return (
              <span key={src} style={styles.legendItem}>
                <span style={{ color: sourceColor(src) }}>{glyph}</span>
                {' '}{src} ({n})
              </span>
            )
          })}
          {noDateCount > 0 && (
            <span style={{ ...styles.legendItem, color: '#9ca3af' }}>
              {noDateCount} undated
            </span>
          )}
        </div>
      )}
    </div>
    </div>
  )
}

// Backward-compat export alias (existing `type: 'timelineOutput'` workflows)
export const TimelineOutputNode = TimelineViewNode

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#2b3340'

const styles = {
  card: {
    background:   '#fff',
    border:       '1.5px solid #d1d5db',
    borderRadius: 8,
    boxShadow:    '0 1px 4px rgba(0,0,0,0.08)',
    overflow:     'hidden',
  },
  header: {
    background:     HEADER_COLOR,
    padding:        '5px 8px 5px 10px',
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            8,
  },
  headerRight: {
    display:    'flex',
    alignItems: 'center',
    gap:        8,
    minWidth:   0,
    overflow:   'hidden',
  },
  title: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  badge: {
    color:        '#94a3b8',
    fontSize:     10,
    fontWeight:   600,
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap' as const,
  },
  fitBtn: {
    fontSize:      9,
    fontWeight:    700,
    border:        '1px solid',
    borderRadius:  3,
    padding:       '2px 6px',
    cursor:        'pointer',
    flexShrink:    0,
    letterSpacing: '0.02em',
  },
  scrollContainer: {
    overflowY:  'hidden'   as const,
    position:   'relative' as const,
    background: '#f8fafc',
    minHeight:  60,
  },
  filterBar: {
    display:        'flex',
    alignItems:     'center',
    gap:            5,
    padding:        '5px 10px',
    borderTop:      '1px solid #e5e7eb',
    background:     '#f8fafc',
    flexShrink:     0,
  },
  dateSelect: {
    fontSize:     10,
    padding:      '2px 4px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    height:       22,
    color:        '#374151',
    background:   '#fff',
    maxWidth:     110,
    cursor:       'pointer',
  },
  filterLabel: {
    fontSize:   10,
    color:      '#6b7280',
    fontWeight: 600,
    flexShrink: 0,
  },
  yearInput: {
    width:        60,
    fontSize:     11,
    padding:      '2px 5px',
    border:       '1px solid #d1d5db',
    borderRadius: 4,
    outline:      'none',
    height:       22,
    fontFamily:   'monospace',
    textAlign:    'center' as const,
  },
  filterSep: {
    fontSize: 11,
    color:    '#9ca3af',
  },
  applyBtn: {
    background:   HEADER_COLOR,
    color:        '#fff',
    border:       'none',
    borderRadius: 4,
    padding:      '2px 8px',
    fontSize:     11,
    cursor:       'pointer',
    height:       22,
    flexShrink:   0,
  },
  filterCount: {
    fontSize:   10,
    color:      '#3b82f6',
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  clearBtn: {
    background:   'transparent',
    color:        '#9ca3af',
    border:       '1px solid #e5e7eb',
    borderRadius: 4,
    padding:      '1px 6px',
    fontSize:     11,
    cursor:       'pointer',
    height:       22,
    flexShrink:   0,
  },
  tooltip: {
    position:     'absolute' as const,
    background:   '#1e293b',
    color:        '#f1f5f9',
    borderRadius: 6,
    padding:      '7px 10px',
    fontSize:     11,
    maxWidth:     220,
    zIndex:       10,
    boxShadow:    '0 2px 8px rgba(0,0,0,0.25)',
    lineHeight:   1.4,
    cursor:       'default',
  },
  tooltipTitle: {
    fontWeight:   600,
    fontSize:     11,
    marginBottom: 3,
    color:        '#f8fafc',
  },
  tooltipMeta: { fontSize: 10, color: '#94a3b8' },
  tooltipLink: {
    display:        'block',
    marginTop:      5,
    fontSize:       10,
    color:          '#34d399',
    textDecoration: 'none' as const,
    pointerEvents:  'auto' as const,
  },
  legend: {
    display:    'flex',
    flexWrap:   'wrap' as const,
    gap:        '3px 14px',
    padding:    '5px 10px 6px',
    background: '#f8fafc',
    borderTop:  '1px solid #e5e7eb',
  },
  legendItem: {
    display:    'flex',
    alignItems: 'center',
    gap:        4,
    fontSize:   10,
    color:      '#4b5563',
  },
  inputHandle: {
    width:     10,
    height:    10,
    background: HEADER_COLOR,
    border:    '2px solid #fff',
    boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  outputHandle: {
    width:     10,
    height:    10,
    background: '#22c55e',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
    top:       13,
  },
}
