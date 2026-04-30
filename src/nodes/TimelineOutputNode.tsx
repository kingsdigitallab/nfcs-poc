/**
 * TimelineOutputNode — SVG timeline visualising records at year resolution.
 *
 * Drag the node edges to resize. Toggle "fit" in the header to compress the
 * full date range into the visible width (no scroll) or restore auto-scale
 * with horizontal scroll for large ranges.
 */

import { useState, useMemo, useRef, useCallback } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import type { UnifiedRecord } from '../types/UnifiedRecord'

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
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 0 && n <= 2200) return n
  }
  const m3 = /\b(\d{3})\b/.exec(s)
  if (m3) return parseInt(m3[1], 10)
  return null
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
const PAD_TOP    = 10
const PAD_BOT    = 26
const DOT_R      = 5
const DOT_GAP    = 13
const MAX_STACK  = 10

// ─── data type ────────────────────────────────────────────────────────────────

export interface TimelineOutputNodeData {
  fitToRange: boolean
  [key: string]: unknown
}

// ─── component ────────────────────────────────────────────────────────────────

interface HoverState {
  record: UnifiedRecord
  svgX:   number
  svgY:   number
}

export function TimelineOutputNode({ id, data, width: measuredWidth }: NodeProps) {
  const { updateNodeData }                       = useReactFlow()
  const { records, connected, status, sourceCount } = useUpstreamRecords(id)
  const [hovered, setHovered]                    = useState<HoverState | null>(null)
  const scrollRef                                = useRef<HTMLDivElement>(null)
  const dismissTimer                             = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fitToRange = (data.fitToRange as boolean | undefined) ?? false
  // measuredWidth is set by xyflow once the node DOM is measured; fall back to default
  const nodeWidth  = measuredWidth ?? DEFAULT_W

  const scheduleHide = useCallback(() => {
    dismissTimer.current = setTimeout(() => setHovered(null), 180)
  }, [])

  const cancelHide = useCallback(() => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current)
      dismissTimer.current = null
    }
  }, [])

  // ── derive timeline items & metrics ───────────────────────────────────────
  const { items, minYear, maxYear, yearMap, bySource, noDateCount } = useMemo(() => {
    const items:    { record: UnifiedRecord; year: number }[] = []
    const bySource: Record<string, number>                   = {}
    let noDateCount = 0

    for (const r of records ?? []) {
      const year = toYear(r.date) ?? toYear(r.eventDate)
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
  }, [records])

  // ── SVG geometry ──────────────────────────────────────────────────────────
  const yearRange = Math.max(maxYear - minYear, 1)

  // Auto-scale: px per year chosen so the timeline is legible without scrolling
  // for small ranges, and compressed for large ones.
  const autoPxPerYear = yearRange <= 30  ? 14
                      : yearRange <= 100 ? 6
                      : yearRange <= 300 ? 3
                      : yearRange <= 800 ? 2
                      : 1

  const plotW = nodeWidth - 20   // subtract card left+right padding equivalent

  const svgW = fitToRange
    // Fit mode: compress the whole range into the visible plot area (no scroll)
    ? Math.max(plotW, PAD_L + PAD_R + 20)
    // Auto mode: use pxPerYear; scroll if wider than the node
    : Math.max(plotW, yearRange * autoPxPerYear + PAD_L + PAD_R)

  // In fit mode derive pxPerYear from the available width
  const pxPerYear = fitToRange
    ? (svgW - PAD_L - PAD_R) / yearRange
    : autoPxPerYear

  const maxStack  = Math.max(0, ...Array.from(yearMap.values()).map(v => v.length))
  const stackRows = Math.min(maxStack, MAX_STACK)
  const svgH      = PAD_TOP + stackRows * DOT_GAP + DOT_R * 2 + PAD_BOT
  const axisY     = svgH - PAD_BOT

  function yearToX(year: number): number {
    return PAD_L + ((year - minYear) / yearRange) * (svgW - PAD_L - PAD_R)
  }

  const ticks = useMemo(
    () => smartTicks(
      minYear, maxYear,
      Math.min(8, Math.max(2, Math.floor((svgW - PAD_L - PAD_R) / 65))),
    ),
    [minYear, maxYear, svgW],
  )

  // ── header text ───────────────────────────────────────────────────────────
  const uniqueYears = new Set(items.map(i => i.year)).size
  const headerNote  = !connected
    ? 'Connect a search or table node'
    : status === 'loading'
      ? 'Loading…'
      : items.length > 0
        ? `${items.length} item${items.length !== 1 ? 's' : ''} · ${uniqueYears} year${uniqueYears !== 1 ? 's' : ''}${noDateCount > 0 ? ` (${noDateCount} undated)` : ''}`
        : records
          ? `No parseable dates${noDateCount > 0 ? ` (${noDateCount} undated)` : ''}`
          : 'Run the upstream node'

  return (
    <div style={{ ...styles.card, width: '100%', minWidth: 300 }}>
      <NodeResizer minWidth={300} maxWidth={1600} minHeight={60} />
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.title}>Timeline Output</span>
        <div style={styles.headerRight}>
          <button
            style={{
              ...styles.fitBtn,
              background:   fitToRange ? '#3b82f6' : 'rgba(255,255,255,0.12)',
              borderColor:  fitToRange ? '#3b82f6' : 'rgba(255,255,255,0.25)',
              color:        fitToRange ? '#fff'    : '#94a3b8',
            }}
            onClick={() => updateNodeData(id, { fitToRange: !fitToRange })}
            className="nodrag"
            title={fitToRange
              ? 'Fit to range: ON — click to restore auto-scale with scroll'
              : 'Click to compress full date range into visible width (no scroll)'}
          >
            ⇤⇥ fit
          </button>
          <span style={styles.badge}>{headerNote}</span>
        </div>
      </div>

      {/* ── Chart (horizontally scrollable in auto mode) ── */}
      <div
        ref={scrollRef}
        className="nodrag nowheel"
        style={{
          ...styles.scrollContainer,
          overflowX: fitToRange ? 'hidden' : 'auto',
        }}
        onMouseLeave={() => { cancelHide(); setHovered(null) }}
      >
        <svg width={svgW} height={svgH} style={{ display: 'block' }}>

          {/* X-axis baseline */}
          <line
            x1={PAD_L} y1={axisY}
            x2={svgW - PAD_R} y2={axisY}
            stroke="#e5e7eb" strokeWidth={1}
          />

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

          {/* Markers, stacked per year */}
          {Array.from(yearMap.entries()).map(([year, yearItems]) => {
            const x = Math.round(yearToX(year))
            return yearItems.slice(0, MAX_STACK).map((item, stackIdx) => {
              const y   = axisY - DOT_R - stackIdx * DOT_GAP
              const clr = sourceColor(item.record._source)
              const shp = sourceShape(item.record._source)
              return (
                <Marker
                  key={item.record.id}
                  shape={shp}
                  cx={x} cy={y} r={DOT_R}
                  color={clr}
                  onMouseEnter={() => { cancelHide(); setHovered({ record: item.record, svgX: x, svgY: y }) }}
                  onMouseLeave={scheduleHide}
                />
              )
            })
          })}

          {/* Overflow label: "+N more" above capped stacks */}
          {Array.from(yearMap.entries())
            .filter(([, v]) => v.length > MAX_STACK)
            .map(([year, v]) => {
              const x = Math.round(yearToX(year))
              const y = axisY - DOT_R - MAX_STACK * DOT_GAP - 4
              return (
                <text key={`ovf-${year}`} x={x} y={y}
                  textAnchor="middle" fontSize={8} fill="#6b7280">
                  +{v.length - MAX_STACK}
                </text>
              )
            })}
        </svg>

        {/* Hover tooltip */}
        {hovered && (() => {
          const scrollLeft = scrollRef.current?.scrollLeft ?? 0
          const visibleW   = scrollRef.current?.clientWidth ?? plotW
          const visibleX   = hovered.svgX - scrollLeft
          const tipLeft    = Math.max(4, Math.min(visibleX + 10, visibleW - 224))
          const tipTop     = Math.max(4, hovered.svgY - 72)
          const r          = hovered.record
          const title      = (r.title ?? r.scientificName ?? '(no title)').slice(0, 60)
          const date       = r.date ?? r.eventDate ?? ''
          const glyph      = SHAPE_GLYPHS[sourceShape(r._source)] ?? '●'
          return (
            <div
              style={{ ...styles.tooltip, left: tipLeft, top: tipTop }}
              onMouseEnter={cancelHide}
              onMouseLeave={scheduleHide}
            >
              <div style={styles.tooltipTitle}>{title}{title.length >= 60 ? '…' : ''}</div>
              <div style={styles.tooltipMeta}>
                <span style={{ color: sourceColor(r._source) }}>{glyph} {r._source ?? ''}</span>
                {date ? ` · ${date}` : ''}
              </div>
              {r._sourceUrl && (
                <a
                  href={r._sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.tooltipLink}
                  onClick={e => e.stopPropagation()}
                >
                  View record →
                </a>
              )}
            </div>
          )
        })()}
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
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#1e293b'

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
    fontSize:     9,
    fontWeight:   700,
    border:       '1px solid',
    borderRadius: 3,
    padding:      '2px 6px',
    cursor:       'pointer',
    flexShrink:   0,
    letterSpacing: '0.02em',
  },
  scrollContainer: {
    overflowY:  'hidden'   as const,
    position:   'relative' as const,
    background: '#f8fafc',
    minHeight:  60,
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
  tooltipMeta: {
    fontSize: 10,
    color:    '#94a3b8',
  },
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
    width:      10,
    height:     10,
    background: HEADER_COLOR,
    border:     '2px solid #fff',
    boxShadow:  `0 0 0 1px ${HEADER_COLOR}`,
  },
}
