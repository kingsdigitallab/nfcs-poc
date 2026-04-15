/**
 * URLFetchNode — follows a URL field in each incoming record, fetches the
 * page content via the /url-proxy Vite middleware (which sidesteps CORS),
 * strips HTML to plain text, and adds fetchedContent to each record.
 *
 * Designed to feed into OllamaFieldNode or OllamaNode for further analysis.
 * Adds the following fields to each record:
 *   fetchedUrl      — the URL that was requested
 *   fetchedContent  — extracted plain text (or empty on error)
 *   fetchStatus     — 'ok' | 'no-url' | 'error: <message>'
 *   fetchedAt       — ISO timestamp
 */

import { useState, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, useReactFlow, useNodes, useEdges, NodeProps } from '@xyflow/react'
import { getNodeResults, setNodeResults, clearNodeResults } from '../store/resultsStore'

export interface URLFetchNodeData {
  urlField: string
  stripHtml: boolean
  maxLength: number
  timeoutSecs: number
  renderJs: boolean
  waitStrategy: 'networkidle0' | 'networkidle2' | 'domcontentloaded'
  status: 'idle' | 'running' | 'success' | 'error'
  statusMessage: string
  results: unknown[] | undefined
  inputCount: number
  outputCount: number
  [key: string]: unknown
}

const HEADER_COLOR = '#0c4a6e'
const BTN_COLOR    = '#0369a1'

const STATUS_BORDER: Record<string, string> = {
  idle:    '#d1d5db',
  running: '#3b82f6',
  success: '#22c55e',
  error:   '#ef4444',
}

// ── HTML processing ───────────────────────────────────────────────────────────
// Returns both the cleaned body HTML (for downstream section picking) and the
// plain-text version (for direct Ollama use). Noise elements are removed once
// and both representations are derived from the same cleaned document.

const NOISE_SELECTORS = 'script, style, nav, footer, header, aside, noscript, iframe, [aria-hidden="true"]'

function processHtml(html: string): { text: string; bodyHtml: string } {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    doc.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove())
    const bodyHtml = doc.body?.innerHTML ?? ''
    const text     = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()
    return { text, bodyHtml }
  } catch {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return { text, bodyHtml: html }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function URLFetchNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as URLFetchNodeData

  const [liveProgress, setLiveProgress] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // ── Upstream records ──────────────────────────────────────────────────────────
  const upstreamRecords = useMemo<Record<string, unknown>[]>(() => {
    const inputEdges = allEdges.filter(e => e.target === id && e.targetHandle === 'data')
    const out: Record<string, unknown>[] = []
    for (const edge of inputEdges) {
      const src  = allNodes.find(n => n.id === edge.source)
      if (!src) continue
      const recs = getNodeResults(src.id)
      if (recs) out.push(...recs)
    }
    return out
  }, [allNodes, allEdges, id])

  // ── Detect URL-like fields from sample record ────────────────────────────────
  const urlFields = useMemo<string[]>(() => {
    if (upstreamRecords.length === 0) return []
    const sample = upstreamRecords[0]
    return Object.entries(sample)
      .filter(([k, v]) => {
        if (typeof v !== 'string') return false
        if (/url|link|href|uri|pid/i.test(k)) return true
        if (String(v).startsWith('http://') || String(v).startsWith('https://')) return true
        return false
      })
      .map(([k]) => k)
  }, [upstreamRecords])

  const urlField     = (d.urlField || urlFields[0] || '_sourceUrl') as string
  const stripHtml    = (d.stripHtml ?? true) as boolean
  const maxLength    = (d.maxLength ?? 8000) as number
  const timeoutSecs  = (d.timeoutSecs ?? 10) as number
  const renderJs     = (d.renderJs ?? false) as boolean
  const waitStrategy = (d.waitStrategy ?? 'networkidle2') as 'networkidle0' | 'networkidle2' | 'domcontentloaded'
  const isRunning    = d.status === 'running'

  // ── Run handler ───────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (upstreamRecords.length === 0) {
      updateNodeData(id, { status: 'error', statusMessage: '✗ No upstream records' })
      return
    }

    abortRef.current = new AbortController()
    const { signal } = abortRef.current

    clearNodeResults(id)
    updateNodeData(id, {
      status: 'running', statusMessage: 'Fetching…',
      inputCount: upstreamRecords.length, outputCount: 0,
    })
    setLiveProgress('')

    const enriched: Record<string, unknown>[] = []
    let okCount = 0
    let errCount = 0

    for (let i = 0; i < upstreamRecords.length; i++) {
      if (signal.aborted) break
      const record = upstreamRecords[i]
      const rawUrl = String(record[urlField] ?? '').trim()

      setLiveProgress(`${i + 1} / ${upstreamRecords.length}`)
      updateNodeData(id, { statusMessage: `Fetching ${i + 1}/${upstreamRecords.length}…` })

      if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
        enriched.push({
          ...record,
          fetchedUrl:     rawUrl,
          fetchedContent: '',
          fetchStatus:    'no-url',
          fetchedAt:      new Date().toISOString(),
        })
        updateNodeData(id, { outputCount: enriched.length })
        continue
      }

      try {
        // When renderJs is on the Vite/Puppeteer side enforces BROWSER_TIMEOUT_MS;
        // give the client a generous margin so the cancel button still works.
        const clientTimeout = renderJs ? 60_000 : timeoutSecs * 1000
        const timeoutSignal = AbortSignal.timeout(clientTimeout)
        const fetchSignal = typeof AbortSignal.any === 'function'
          ? AbortSignal.any([signal, timeoutSignal])
          : signal

        const proxyUrl = `/url-proxy?url=${encodeURIComponent(rawUrl)}`
          + (renderJs ? `&js=true&wait=${waitStrategy}` : '')
        const res = await fetch(proxyUrl, { signal: fetchSignal })

        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const contentType = res.headers.get('content-type') ?? ''
        const rawText = await res.text()

        let fetchedContent: string
        let fetchedHtml: string | undefined

        const isHtml = contentType.includes('html') || rawText.trimStart().startsWith('<')
        if (isHtml) {
          const processed = processHtml(rawText)
          fetchedHtml    = processed.bodyHtml
          fetchedContent = processed.text
        } else {
          fetchedContent = rawText
        }

        if (fetchedContent.length > maxLength) fetchedContent = fetchedContent.slice(0, maxLength) + '…[truncated]'

        enriched.push({
          ...record,
          fetchedUrl:     rawUrl,
          fetchedContent,
          ...(fetchedHtml !== undefined ? { fetchedHtml } : {}),
          fetchStatus:    'ok',
          fetchedAt:      new Date().toISOString(),
        })
        okCount++
      } catch (err) {
        const name = (err as { name?: string }).name
        if (name === 'AbortError' && signal.aborted) {
          // User cancelled — stop processing
          break
        }
        errCount++
        const msg = err instanceof Error ? err.message : String(err)
        enriched.push({
          ...record,
          fetchedUrl:     rawUrl,
          fetchedContent: '',
          fetchStatus:    `error: ${msg}`,
          fetchedAt:      new Date().toISOString(),
        })
      }

      updateNodeData(id, { outputCount: enriched.length })
    }

    setLiveProgress('')

    if (signal.aborted && enriched.length < upstreamRecords.length) {
      if (enriched.length > 0) setNodeResults(id, enriched)
      updateNodeData(id, {
        status:        'idle',
        statusMessage: `Cancelled (${okCount} fetched)`,
        outputCount:   enriched.length,
      })
      return
    }

    const version = setNodeResults(id, enriched)
    updateNodeData(id, {
      status:         errCount > 0 && okCount === 0 ? 'error' : 'success',
      statusMessage:  `✓ ${okCount} fetched${errCount > 0 ? `, ${errCount} errors` : ''}`,
      outputCount:    enriched.length,
      resultsVersion: version,
    })
  }, [id, updateNodeData, upstreamRecords, urlField, stripHtml, maxLength, timeoutSecs, renderJs, waitStrategy])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const status      = (d.status ?? 'idle') as string
  const borderColor = STATUS_BORDER[status] ?? '#d1d5db'

  const storedResults = getNodeResults(id)
  const okCount  = storedResults?.filter(r => r.fetchStatus === 'ok').length ?? 0
  const errCount = storedResults?.filter(r => (r.fetchStatus as string)?.startsWith('error')).length ?? 0

  return (
    <div style={{ ...styles.card, borderColor }}>
      <Handle type="target" position={Position.Left} id="data" style={styles.inputHandle} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>URL Fetch</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      <div style={styles.body}>
        {/* URL field picker */}
        <div style={styles.row}>
          <span style={styles.label}>URL field</span>
          {urlFields.length > 0 ? (
            <select style={styles.select} value={urlField}
              onChange={e => updateNodeData(id, { urlField: e.target.value })} className="nodrag">
              {urlFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <input style={styles.input} value={urlField}
              onChange={e => updateNodeData(id, { urlField: e.target.value })}
              placeholder="_sourceUrl" className="nodrag" />
          )}
        </div>

        {/* Strip HTML */}
        <label style={styles.checkLabel} className="nodrag">
          <input type="checkbox" checked={stripHtml}
            onChange={e => updateNodeData(id, { stripHtml: e.target.checked })}
            style={{ marginRight: 5 }} />
          Strip HTML to plain text
        </label>

        {/* JS rendering */}
        <label style={styles.checkLabel} className="nodrag">
          <input type="checkbox" checked={renderJs}
            onChange={e => updateNodeData(id, { renderJs: e.target.checked })}
            style={{ marginRight: 5 }} />
          Wait for JS rendering
          <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>(headless browser)</span>
        </label>

        {/* Wait strategy — only shown when renderJs is on */}
        {renderJs && (
          <div style={styles.row}>
            <span style={styles.label}>Wait for</span>
            <select style={styles.select} value={waitStrategy}
              onChange={e => updateNodeData(id, { waitStrategy: e.target.value })}
              className="nodrag">
              <option value="networkidle2">Network quiet (2 req)</option>
              <option value="networkidle0">Network fully idle</option>
              <option value="domcontentloaded">DOM ready only</option>
            </select>
          </div>
        )}

        {renderJs && (
          <div style={styles.jsNote}>
            ℹ First JS-render request launches a headless browser in the Vite dev server — expect a few extra seconds on first use.
          </div>
        )}

        {/* Max chars */}
        <div style={styles.row}>
          <span style={styles.label}>Max chars</span>
          <input type="number" style={{ ...styles.input, width: 80 }} value={maxLength}
            min={500} max={100000} step={500}
            onChange={e => updateNodeData(id, { maxLength: parseInt(e.target.value, 10) || 8000 })}
            className="nodrag" />
        </div>

        {/* Timeout */}
        <div style={styles.row}>
          <span style={styles.label}>Timeout</span>
          <input type="number" style={{ ...styles.input, width: 60 }} value={timeoutSecs}
            min={2} max={60}
            onChange={e => updateNodeData(id, { timeoutSecs: parseInt(e.target.value, 10) || 10 })}
            className="nodrag" />
          <span style={{ fontSize: 10, color: '#9ca3af' }}>sec / URL</span>
        </div>

        {/* Progress */}
        {isRunning && liveProgress && (
          <div style={styles.progressBanner}>⚙ Fetching {liveProgress}</div>
        )}

        {/* Post-run summary pills */}
        {!isRunning && storedResults && (
          <div style={styles.resultRow}>
            {okCount > 0  && <span style={{ ...styles.pill, background: '#dcfce7', color: '#166534' }}>✓ {okCount} ok</span>}
            {errCount > 0 && <span style={{ ...styles.pill, background: '#fee2e2', color: '#991b1b' }}>✗ {errCount} errors</span>}
          </div>
        )}

        <div style={styles.note}>
          Adds <code style={{ fontFamily: 'monospace', background: '#f3f4f6', padding: '0 3px' }}>fetchedContent</code> (plain text) and <code style={{ fontFamily: 'monospace', background: '#f3f4f6', padding: '0 3px' }}>fetchedHtml</code> (structured HTML) to each record.
          Connect to an HTML Section node to pick specific sections.
        </div>
      </div>

      <div style={styles.footer}>
        {isRunning ? (
          <button style={{ ...styles.btn, background: '#dc2626' }} onClick={handleCancel} className="nodrag">
            ✕ Cancel
          </button>
        ) : (
          <button style={{ ...styles.btn, background: BTN_COLOR }} onClick={handleRun} className="nodrag">
            ▶ Fetch URLs
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
    minWidth: 260,
    maxWidth: 300,
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
    color: '#bae6fd',
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
    flex: 1,
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  input: {
    flex: 1,
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
  },
  checkLabel: {
    display: 'flex',
    alignItems: 'center',
    fontSize: 11,
    color: '#374151',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  progressBanner: {
    fontSize: 10,
    color: '#1d4ed8',
    background: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: 4,
    padding: '3px 7px',
    fontFamily: 'monospace',
  },
  resultRow: {
    display: 'flex',
    gap: 6,
  },
  pill: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 10,
  },
  jsNote: {
    fontSize: 10,
    color: '#92400e',
    background: '#fffbeb',
    border: '1px solid #fde68a',
    borderRadius: 4,
    padding: '4px 7px',
    lineHeight: 1.5,
  },
  note: {
    fontSize: 10,
    color: '#9ca3af',
    lineHeight: 1.5,
    paddingTop: 2,
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
    background: '#0ea5e9',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #0ea5e9',
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
