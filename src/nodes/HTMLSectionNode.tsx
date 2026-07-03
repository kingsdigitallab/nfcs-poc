/**
 * HTMLSectionNode — picks a CSS selector against the `fetchedHtml` field added
 * by URLFetchNode and extracts the matching sections' text into `fetchedContent`,
 * replacing the full-page text with only the targeted portion.
 *
 * UI shows a structural preview of the first upstream record (headings, landmarks,
 * named divs) so the user can click to populate the selector field without
 * needing to inspect the raw HTML.
 *
 * Fields added / updated on each record:
 *   fetchedContent  — text of all matching elements (overwritten)
 *   htmlSelector    — the CSS selector used (for provenance)
 */

import { useState, useCallback, useMemo, useRef } from 'react'
import { Handle, Position, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { Readability } from '@mozilla/readability'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

export interface HTMLSectionNodeData {
  selector: string
  separator: string
  maxLength: number
  preserveHtml: boolean
  extractSection: boolean
  status: 'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  inputCount: number
  outputCount: number
  [key: string]: unknown
}

const HEADER_COLOR = '#3a5a44'
const BTN_COLOR    = '#047857'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── Structural analysis ───────────────────────────────────────────────────────
// Scans the first record's bodyHtml and returns pickable elements with their
// CSS selectors and a short text preview.

interface StructuralItem {
  selector: string
  label: string
  preview: string
}

function analyseHtml(html: string): StructuralItem[] {
  try {
    const parser = new DOMParser()
    const doc    = parser.parseFromString(html, 'text/html')
    const items: StructuralItem[] = []
    const seenSelectors = new Set<string>()

    const tryAdd = (el: Element, selector: string, label: string) => {
      if (seenSelectors.has(selector)) return
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
      if (!text) return
      try { if (doc.querySelectorAll(selector).length === 0) return } catch { return }
      seenSelectors.add(selector)
      items.push({ selector, label, preview: text })
    }

    // Walk up the DOM building a path selector using nth-child (per-parent index
    // of all children regardless of tag) until the selector is unique or we hit
    // an element with an ID. nth-child is used rather than nth-of-type because it
    // reflects the element's true structural position in mixed-content containers.
    const buildPathSelector = (el: Element): string | null => {
      const parts: string[] = []
      let cur: Element | null = el
      while (cur && cur.tagName !== 'BODY' && cur.tagName !== 'HTML') {
        const tag = cur.tagName.toLowerCase()
        if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) { parts.unshift(`#${cur.id}`); break }
        const parent = cur.parentElement
        if (parent) {
          const idx = Array.from(parent.children).indexOf(cur) + 1
          parts.unshift(`${tag}:nth-child(${idx})`)
        } else {
          parts.unshift(tag)
        }
        cur = cur.parentElement
        if (parts.length >= 5) break
        try { if (doc.querySelectorAll(parts.join(' > ')).length === 1) break } catch { break }
      }
      if (!parts.length) return null
      const sel = parts.join(' > ')
      try { return doc.querySelectorAll(sel).length > 0 ? sel : null } catch { return null }
    }

    // Semantic landmarks
    for (const [sel, label] of [['main','main'],['article','article'],['[role="main"]','[role="main"]']] as [string,string][]) {
      const el = doc.querySelector(sel)
      if (el) tryAdd(el, sel, label)
    }

    // Named sections
    doc.querySelectorAll('section[id], article[id], div[id]').forEach(el => {
      const sel = `${el.tagName.toLowerCase()}#${el.id}`
      tryAdd(el, sel, sel)
    })

    // Headings (h1–h3) — try nth-of-type first (works when headings are siblings);
    // fall back to a path selector for the common SPA pattern where each heading
    // lives in its own container div (making nth-of-type always 1 and non-unique).
    const tagCounts: Record<string, number> = {}
    doc.querySelectorAll('h1, h2, h3').forEach(el => {
      const tag   = el.tagName.toLowerCase()
      tagCounts[tag] = (tagCounts[tag] ?? 0) + 1
      const label = `${tag}: ${(el.textContent ?? '').trim().slice(0, 30)}`
      const nthSel = `${tag}:nth-of-type(${tagCounts[tag]})`
      try {
        if (doc.querySelectorAll(nthSel).length > 0) { tryAdd(el, nthSel, label); return }
      } catch { /* fall through */ }
      const pathSel = buildPathSelector(el)
      if (pathSel) tryAdd(el, pathSel, label)
    })

    return items.slice(0, 30)
  } catch {
    return []
  }
}

// ── Extraction from selector ──────────────────────────────────────────────────

function extractBySelector(
  html: string,
  selector: string,
  separator: string,
  preserveHtml: boolean,
): string {
  try {
    const parser = new DOMParser()
    const doc    = parser.parseFromString(html, 'text/html')
    const els    = doc.querySelectorAll(selector)
    if (els.length === 0) return ''
    if (preserveHtml) {
      return Array.from(els)
        .map(el => el.outerHTML)
        .filter(Boolean)
        .join(separator)
    }
    return Array.from(els)
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(separator)
  } catch {
    return ''
  }
}

// ── Section-after-heading extraction ─────────────────────────────────────────
// Finds the first element matching the selector (expected to be a heading),
// then collects it plus all following siblings until the next heading of equal
// or higher rank. Works best when the heading and its content are siblings
// within the same parent container.

function extractSectionFromHeading(
  html: string,
  selector: string,
  separator: string,
  preserveHtml: boolean,
): string {
  try {
    const doc     = new DOMParser().parseFromString(html, 'text/html')
    const heading = doc.querySelector(selector)
    if (!heading) return ''

    const level   = parseInt(heading.tagName[1]) || 0
    const getText = (el: Element) =>
      preserveHtml ? el.outerHTML : (el.textContent ?? '').replace(/\s+/g, ' ').trim()

    const parts: string[] = [getText(heading)]
    let sibling = heading.nextElementSibling
    while (sibling) {
      const tag = sibling.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag) && parseInt(tag[1]) <= level) break
      const content = getText(sibling)
      if (content) parts.push(content)
      sibling = sibling.nextElementSibling
    }
    return parts.filter(Boolean).join(separator)
  } catch {
    return ''
  }
}

// ── Readability extraction ────────────────────────────────────────────────────
// Uses Mozilla Readability (same algorithm as Firefox Reader Mode) to extract
// the main article content from the page. Works best for editorial/article pages;
// less reliable for data portals or heavily structured UIs.

function extractReadability(html: string, preserveHtml: boolean): string {
  try {
    const doc     = new DOMParser().parseFromString(html, 'text/html')
    const article = new Readability(doc).parse()
    if (!article) return ''
    return preserveHtml
      ? (article.content ?? '')
      : (article.textContent ?? '').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HTMLSectionNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as HTMLSectionNodeData

  const [showPicker, setShowPicker] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // ── Upstream records ──────────────────────────────────────────────────────
  const upstreamRecords = useMemo<Record<string, unknown>[]>(() => {
    const inputEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'data')
    const out: Record<string, unknown>[] = []
    for (const edge of inputEdges) {
      const src = allNodes.find(n => n.id === edge.source)
      if (!src) continue
      const recs = getNodeResults(src.id)
      if (recs) out.push(...recs)
    }
    return out
  }, [allNodes, allEdges, id])

  const firstHtml = useMemo(() => {
    for (const r of upstreamRecords) {
      if (typeof r.fetchedHtml === 'string' && r.fetchedHtml.length > 0) return r.fetchedHtml
    }
    return ''
  }, [upstreamRecords])

  const structuralItems = useMemo(() => analyseHtml(firstHtml), [firstHtml])

  const selector       = (d.selector       ?? 'main, article') as string
  const separator      = (d.separator      ?? '\n\n')           as string
  const maxLength      = (d.maxLength      ?? 8000)             as number
  const preserveHtml   = (d.preserveHtml   ?? false)            as boolean
  const extractSection = (d.extractSection ?? false)            as boolean
  const isRunning      = d.status === 'running'
  const isReadability  = selector === '@readability'

  const livePreview = useMemo(() => {
    if (!firstHtml || !selector) return ''
    let result: string
    if (isReadability) {
      result = extractReadability(firstHtml, preserveHtml)
    } else if (extractSection) {
      result = extractSectionFromHeading(firstHtml, selector, separator, preserveHtml)
    } else {
      result = extractBySelector(firstHtml, selector, separator, preserveHtml)
    }
    return result.slice(0, 300) + (result.length > 300 ? '…' : '')
  }, [firstHtml, selector, separator, preserveHtml, extractSection, isReadability])

  // ── Run handler ──────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (upstreamRecords.length === 0) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No upstream records' })
      return
    }

    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    clearNodeResults(id)
    updateNodeData(id, {
      status: 'running', statusMessage: 'Extracting…',
      inputCount: upstreamRecords.length, outputCount: 0,
    })

    const enriched: Record<string, unknown>[] = []
    let hitCount  = 0
    let missCount = 0

    for (let i = 0; i < upstreamRecords.length; i++) {
      if (signal.aborted) break
      const record = upstreamRecords[i]
      const html   = typeof record.fetchedHtml === 'string' ? record.fetchedHtml : ''

      if (!html) {
        // No HTML available — pass record through unchanged
        missCount++
        enriched.push({ ...record, htmlSelector: selector })
        continue
      }

      let extracted = isReadability
        ? extractReadability(html, preserveHtml)
        : extractSection
          ? extractSectionFromHeading(html, selector, separator, preserveHtml)
          : extractBySelector(html, selector, separator, preserveHtml)
      if (!extracted) {
        missCount++
        enriched.push({ ...record, fetchedContent: '', htmlSelector: selector })
        continue
      }
      if (extracted.length > maxLength) extracted = extracted.slice(0, maxLength) + '…[truncated]'
      hitCount++
      enriched.push({ ...record, fetchedContent: extracted, htmlSelector: selector })
    }

    if (signal.aborted) {
      if (enriched.length > 0) setNodeResults(id, enriched)
      updateNodeData(id, {
        status: 'idle', statusMessage: `Cancelled (${hitCount} extracted)`,
        outputCount: enriched.length,
      })
      return
    }

    const version = setNodeResults(id, enriched)
    updateNodeData(id, {
      status:         missCount > 0 && hitCount === 0 ? 'error' : 'success',
      statusMessage:  `✓ ${hitCount} extracted${missCount > 0 ? `, ${missCount} no match` : ''}`,
      outputCount:    enriched.length,
      resultsVersion: version,
    })
  }, [id, updateNodeData, upstreamRecords, selector, separator, maxLength, preserveHtml, extractSection, isReadability])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const borderColor = STATUS_BORDER[(d.status ?? 'idle') as string] ?? '#d1d5db'
  const hasHtml     = firstHtml.length > 0

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      <div style={styles.header}>
        <span style={styles.headerTitle}>HTML Section</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      <div style={styles.body}>

        {/* CSS selector field */}
        <div style={styles.row}>
          <span style={styles.label}>Selector</span>
          <input
            style={{ ...styles.input, flex: 1 }}
            value={selector}
            onChange={e => updateNodeData(id, { selector: e.target.value })}
            placeholder="main, article, #content"
            className="nodrag"
          />
        </div>

        {/* Preserve HTML toggle */}
        <label style={styles.checkLabel} className="nodrag">
          <input
            type="checkbox"
            checked={preserveHtml}
            onChange={e => updateNodeData(id, { preserveHtml: e.target.checked })}
            style={{ marginRight: 5 }}
          />
          Preserve HTML structure
        </label>

        {/* Readability preset */}
        <button
          style={isReadability ? styles.presetBtnActive : styles.presetBtn}
          onClick={() => updateNodeData(id, { selector: isReadability ? 'main, article' : '@readability' })}
          className="nodrag"
        >
          {isReadability ? '✦ Readability active — click to reset' : '✦ Use main content (Readability)'}
        </button>

        {/* Section extraction checkbox — only when using a CSS selector */}
        {!isReadability && (
          <label style={styles.checkLabel} className="nodrag">
            <input
              type="checkbox"
              checked={extractSection}
              onChange={e => updateNodeData(id, { extractSection: e.target.checked })}
              style={{ marginRight: 5 }}
            />
            Extract heading + following content
          </label>
        )}

        {/* Structural picker toggle */}
        {hasHtml && !isReadability && (
          <button
            style={styles.pickerToggle}
            onClick={() => setShowPicker(v => !v)}
            className="nodrag"
          >
            {showPicker ? '▲ Hide structure' : '▼ Pick from page structure'}
          </button>
        )}

        {!hasHtml && (
          <div style={styles.hint}>
            Connect a URL Fetch node and run it to enable structure preview.
          </div>
        )}

        {/* Structural items */}
        {showPicker && hasHtml && !isReadability && (
          <div style={styles.pickerList} className="nodrag nowheel">
            {structuralItems.length === 0 && (
              <div style={styles.pickerEmpty}>No named landmarks or headings found.</div>
            )}
            {structuralItems.map((item, i) => (
              <button
                key={i}
                style={{
                  ...styles.pickerItem,
                  background: selector === item.selector ? '#d1fae5' : '#f9fafb',
                  borderColor: selector === item.selector ? '#34d399' : '#e5e7eb',
                }}
                onClick={() => updateNodeData(id, { selector: item.selector })}
                className="nodrag"
              >
                <code style={styles.pickerSel}>{item.selector}</code>
                <span style={styles.pickerPrev}>{item.preview}</span>
              </button>
            ))}
          </div>
        )}

        {/* Live preview */}
        {hasHtml && livePreview && (
          <div style={styles.preview} className="nodrag nowheel">
            <div style={styles.previewLabel}>
              Preview (first record) — {preserveHtml ? 'HTML' : 'text'}
            </div>
            <div style={{
              ...styles.previewText,
              ...(preserveHtml ? { fontFamily: 'monospace', fontSize: 9, whiteSpace: 'pre-wrap' as const } : {}),
            }}>
              {livePreview}
            </div>
          </div>
        )}

        {hasHtml && !livePreview && selector && (
          <div style={styles.noMatch}>
            {isReadability ? '⚠ No main article content detected' : '⚠ Selector matches nothing in first record'}
          </div>
        )}

        {/* Separator */}
        <div style={styles.row}>
          <span style={styles.label}>Separator</span>
          <select
            style={{ ...styles.select, flex: 1 }}
            value={separator}
            onChange={e => updateNodeData(id, { separator: e.target.value })}
            className="nodrag"
          >
            <option value={'\n\n'}>Double newline</option>
            <option value={'\n'}>Single newline</option>
            <option value={' | '}> | </option>
            <option value={' '}>Space</option>
          </select>
        </div>

        {/* Max chars */}
        <div style={styles.row}>
          <span style={styles.label}>Max chars</span>
          <input
            type="number"
            style={{ ...styles.input, width: 80 }}
            value={maxLength}
            min={500} max={100000} step={500}
            onChange={e => updateNodeData(id, { maxLength: parseInt(e.target.value, 10) || 8000 })}
            className="nodrag"
          />
        </div>

        <div style={styles.note}>
          Overwrites <code style={styles.code}>fetchedContent</code> with {preserveHtml ? 'HTML' : 'text'} from
          matched elements. Adds <code style={styles.code}>htmlSelector</code> for provenance.
        </div>
      </div>

      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button style={{ ...styles.btn, background: BTN_COLOR }} onClick={handleRun} className="nodrag">
            ▶ Extract Sections
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="results" style={styles.outputHandle} />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    minWidth: 280,
    maxWidth: 320,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
    position: 'relative' as const,
    transition: 'border-color 0.25s',
  },
  header: {
    height: 32,
    background: HEADER_COLOR,
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
  headerStatus: {
    fontSize: 10,
    fontWeight: 600,
    color: '#a7f3d0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  body: {
    padding: '10px 12px 6px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 7,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    width: 60,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  input: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
    fontFamily: 'monospace',
  },
  hint: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic' as const,
    lineHeight: 1.5,
  },
  pickerToggle: {
    fontSize: 10,
    color: '#065f46',
    background: '#ecfdf5',
    border: '1px solid #a7f3d0',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  presetBtn: {
    fontSize: 10,
    color: '#1e40af',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
  },
  presetBtnActive: {
    fontSize: 10,
    color: '#fff',
    background: '#1d4ed8',
    border: '1px solid #1d4ed8',
    borderRadius: 4,
    padding: '3px 8px',
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
  },
  pickerList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
    maxHeight: 180,
    overflowY: 'auto' as const,
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    padding: '4px',
    background: '#fff',
  },
  pickerEmpty: {
    fontSize: 10,
    color: '#9ca3af',
    textAlign: 'center' as const,
    padding: '8px',
  },
  pickerItem: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'flex-start',
    gap: 2,
    padding: '4px 6px',
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    cursor: 'pointer',
    textAlign: 'left' as const,
    width: '100%',
  },
  pickerSel: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#065f46',
    fontWeight: 600,
  },
  pickerPrev: {
    fontSize: 10,
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '100%',
  },
  preview: {
    border: '1px solid #d1fae5',
    borderRadius: 4,
    padding: '5px 7px',
    background: '#f0fdf4',
  },
  previewLabel: {
    fontSize: 9,
    color: '#059669',
    fontWeight: 700,
    marginBottom: 3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  previewText: {
    fontSize: 10,
    color: '#374151',
    lineHeight: 1.5,
    maxHeight: 80,
    overflowY: 'auto' as const,
    whiteSpace: 'pre-wrap' as const,
  },
  noMatch: {
    fontSize: 10,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 4,
    padding: '4px 7px',
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  note: {
    fontSize: 10,
    color: '#9ca3af',
    lineHeight: 1.5,
    paddingTop: 2,
  },
  code: {
    fontFamily: 'monospace',
    background: '#f3f4f6',
    padding: '0 3px',
  },
  footer: {
    padding: '6px 10px 8px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  btn: {
    color: '#fff',
    border: 'none',
    borderRadius: 5,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  inputHandle: {
    width: 8,
    height: 8,
    background: '#34d399',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #34d399',
    position: 'absolute' as const,
    left: -5,
    borderRadius: '50%',
  },
  outputHandle: {
    width: 10,
    height: 10,
    background: '#22c55e',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
