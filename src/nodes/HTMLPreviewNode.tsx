import { useState, useEffect, useMemo, useCallback } from 'react'
import { Handle, Position, NodeProps, NodeResizer, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import { getNodeResults } from '../store/resultsStore'

export interface HTMLPreviewNodeData {
  mode: 'captured' | 'live'
  urlField: string
  [key: string]: unknown
}

const HEADER_COLOR = '#0c4a6e'

// ── srcdoc builder ────────────────────────────────────────────────────────────
// Wraps the stored fetchedHtml in a minimal readability stylesheet and injects
// a click-capture script that sends the clicked element's CSS selector back to
// the parent page via postMessage.

const PREVIEW_CSS = [
  '*{box-sizing:border-box}',
  'body{font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;padding:16px;margin:0}',
  'h1{font-size:1.5em}h2{font-size:1.3em}h3{font-size:1.15em}h4{font-size:1.05em}',
  'h1,h2,h3,h4,h5,h6{color:#111827;margin-top:1.2em;margin-bottom:.3em;font-weight:600}',
  'p{margin:.6em 0}a{color:#2563eb;text-decoration:none}',
  'img{max-width:100%;height:auto}ul,ol{padding-left:1.5em}li{margin:.2em 0}',
  'table{border-collapse:collapse;width:100%;font-size:13px}',
  'td,th{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}',
  'th{background:#f9fafb;font-weight:600}',
  // Hide known map containers before scripts run to prevent layout thrash
  '.leaflet-container,.mapboxgl-map,.ol-viewport,.gm-style,[class*="MapContainer"]{display:none}',
  'body *{cursor:pointer}',
  'body *:hover{outline:2px solid rgba(59,130,246,.5)!important;outline-offset:1px}',
  '.--sel--{outline:2px solid #22c55e!important;outline-offset:1px;background:rgba(34,197,94,.08)!important}',
].join('')

// Selector generator: walks up the DOM building a path, stopping at the first
// ancestor with an ID. nth-of-type indices are relative to each parent, matching
// how CSS selectors work — consistent with HTMLExtract's querySelectorAll usage.
const CAPTURE_SCRIPT = [
  '(function(){',
  // Replace hidden map containers with a visible placeholder so the layout
  // doesn't just have an invisible hole where the map was.
  'var MAP_SELS=[".leaflet-container",".mapboxgl-map",".ol-viewport",".gm-style","[class*=\'MapContainer\']"];',
  'MAP_SELS.forEach(function(s){',
  '  document.querySelectorAll(s).forEach(function(el){',
  '    var ph=document.createElement("div");',
  '    ph.style.cssText="border:1px dashed #d1d5db;border-radius:4px;padding:10px;font-size:11px;color:#9ca3af;text-align:center;margin:8px 0;background:#fafafa";',
  '    ph.textContent="[ Map — use Live mode to view ]";',
  '    el.parentNode&&el.parentNode.replaceChild(ph,el);',
  '  });',
  '});',
  'var _sel=null;',
  'function mkSel(el){',
  '  if(!el||el===document.body)return"body";',
  '  if(el.id&&/^[a-zA-Z][\\w-]*$/.test(el.id))return"#"+el.id;',
  '  var parts=[],cur=el,depth=0;',
  '  while(cur&&cur.tagName&&cur!==document.body&&depth++<5){',
  '    var tag=cur.tagName.toLowerCase();',
  '    if(cur.id&&/^[a-zA-Z][\\w-]*$/.test(cur.id)){parts.unshift("#"+cur.id);break;}',
  '    var par=cur.parentElement;',
  '    if(par){',
  '      var sibs=Array.from(par.children).filter(function(c){return c.tagName===cur.tagName;});',
  '      if(sibs.length>1)tag+=":nth-of-type("+(sibs.indexOf(cur)+1)+")";',
  '    }',
  '    parts.unshift(tag);cur=cur.parentElement;',
  '  }',
  '  return parts.join(" > ");',
  '}',
  'document.addEventListener("click",function(e){',
  '  e.preventDefault();e.stopPropagation();',
  '  if(_sel)_sel.classList.remove("--sel--");',
  '  _sel=e.target;_sel.classList.add("--sel--");',
  '  var s=mkSel(_sel);',
  '  var t=(_sel.textContent||"").replace(/\\s+/g," ").trim().slice(0,150);',
  '  window.parent.postMessage({type:"html-preview-click",selector:s,text:t},"*");',
  '});',
  '})();',
].join('\n')

function buildSrcdoc(html: string): string {
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    PREVIEW_CSS +
    '</style></head><body>' +
    html +
    '<script>' + CAPTURE_SCRIPT + '<' + '/script></body></html>'
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function HTMLPreviewNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const allNodes = useNodes()
  const allEdges = useEdges()
  const d = data as HTMLPreviewNodeData

  const [recordIndex, setRecordIndex]         = useState(0)
  const [capturedSelector, setCapturedSelector] = useState('')
  const [capturedText, setCapturedText]         = useState('')
  const [copied, setCopied]                     = useState(false)

  const mode     = (d.mode     ?? 'captured') as 'captured' | 'live'
  const urlField = (d.urlField ?? '_sourceUrl') as string

  // ── Upstream records ──────────────────────────────────────────────────────
  const records = useMemo<Record<string, unknown>[]>(() => {
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

  const clampedIdx = records.length === 0 ? 0 : Math.min(recordIndex, records.length - 1)
  const record     = records[clampedIdx] ?? null

  const fetchedHtml = typeof record?.fetchedHtml === 'string' ? record.fetchedHtml : ''

  // Resolve dot-notation URL fields (e.g. adsLibrary.downloadUrl)
  const resolveField = useCallback((rec: Record<string, unknown>, field: string): string => {
    if (!field.includes('.')) return String(rec[field] ?? '')
    const [ns, key] = field.split('.', 2)
    const ns_obj = rec[ns]
    if (ns_obj && typeof ns_obj === 'object') return String((ns_obj as Record<string, unknown>)[key] ?? '')
    return ''
  }, [])

  const liveUrl = record ? resolveField(record, urlField) : ''

  // Detect URL-like fields from current record for the live-mode field picker
  const urlFields = useMemo<string[]>(() => {
    if (!record) return []
    const out: string[] = []
    const isUrlLike = (k: string, v: unknown) => {
      if (typeof v !== 'string') return false
      return /url|link|href|uri|pid/i.test(k) || v.startsWith('http')
    }
    for (const [k, v] of Object.entries(record)) {
      if (isUrlLike(k, v)) out.push(k)
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (isUrlLike(sk, sv)) out.push(`${k}.${sk}`)
        }
      }
    }
    return out
  }, [record])

  // ── postMessage listener for click-to-capture ─────────────────────────────
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'html-preview-click') {
        setCapturedSelector(e.data.selector ?? '')
        setCapturedText(e.data.text ?? '')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const srcdoc = useMemo(() => fetchedHtml ? buildSrcdoc(fetchedHtml) : '', [fetchedHtml])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(capturedSelector).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }, [capturedSelector])

  const hasRecords = records.length > 0
  const hasHtml    = fetchedHtml.length > 0

  return (
    <div style={styles.card}>
      <NodeResizer minWidth={340} minHeight={400} isVisible={!!selected} />

      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>HTML Preview</span>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['captured', 'live'] as const).map(m => (
            <button
              key={m}
              style={{ ...styles.modeBtn, background: mode === m ? '#1e40af' : 'rgba(255,255,255,0.18)' }}
              onClick={() => updateNodeData(id, { mode: m })}
              title={m === 'live' ? 'Load URL directly — may be blocked by site' : 'Show stored HTML with click-to-capture'}
              className="nodrag"
            >
              {m === 'captured' ? 'Captured' : 'Live'}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      {(hasRecords || mode === 'live') && (
        <div style={styles.toolbar}>
          {records.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button style={styles.navBtn} onClick={() => setRecordIndex(i => Math.max(0, i - 1))} disabled={clampedIdx === 0} className="nodrag">‹</button>
              <span style={styles.navLabel}>{clampedIdx + 1} / {records.length}</span>
              <button style={styles.navBtn} onClick={() => setRecordIndex(i => Math.min(records.length - 1, i + 1))} disabled={clampedIdx >= records.length - 1} className="nodrag">›</button>
            </div>
          )}
          {mode === 'live' && urlFields.length > 1 && (
            <select style={styles.select} value={urlField} onChange={e => updateNodeData(id, { urlField: e.target.value })} className="nodrag">
              {urlFields.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {mode === 'live' && (
            <span style={styles.liveWarning}>⚠ some sites block embedding</span>
          )}
        </div>
      )}

      {/* iframe */}
      <div style={styles.iframeWrap} className="nodrag nowheel">
        {!hasRecords && (
          <div style={styles.empty}>Connect a URLContentFetch node and run it</div>
        )}
        {hasRecords && mode === 'captured' && !hasHtml && (
          <div style={styles.empty}>No captured HTML — run the upstream URLContentFetch node first</div>
        )}
        {hasRecords && mode === 'captured' && hasHtml && (
          <iframe
            key={`c-${clampedIdx}`}
            srcDoc={srcdoc}
            sandbox="allow-scripts"
            style={styles.iframe}
            title="HTML Preview"
          />
        )}
        {hasRecords && mode === 'live' && liveUrl && (
          <iframe
            key={`l-${clampedIdx}`}
            src={liveUrl}
            style={styles.iframe}
            title="Live Preview"
          />
        )}
        {hasRecords && mode === 'live' && !liveUrl && (
          <div style={styles.empty}>No URL found in field "{urlField}"</div>
        )}
      </div>

      {/* Selector capture bar */}
      <div style={styles.selectorBar}>
        {mode === 'captured' ? (
          capturedSelector ? (
            <div style={{ display: 'flex', gap: 5, alignItems: 'center', width: '100%', minWidth: 0 }}>
              <code style={styles.selectorCode}>{capturedSelector}</code>
              <span style={styles.capturedText} title={capturedText}>{capturedText}</span>
              <button
                style={{ ...styles.copyBtn, background: copied ? '#059669' : '#1d4ed8', flexShrink: 0 }}
                onClick={handleCopy}
                className="nodrag"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <span style={styles.hint}>Click any element above to capture its CSS selector</span>
          )
        ) : null}
      </div>

      <Handle type="target" position={Position.Left} id="data" style={styles.handle} />
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fff',
    border: '2px solid #d1d5db',
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative' as const,
    minWidth: 340,
    minHeight: 400,
  },
  header: {
    height: 32,
    background: HEADER_COLOR,
    borderRadius: '6px 6px 0 0',
    padding: '0 8px 0 10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  title: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 12,
  },
  modeBtn: {
    fontSize: 10,
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: 3,
    padding: '2px 7px',
    cursor: 'pointer',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    borderBottom: '1px solid #f3f4f6',
    background: '#f9fafb',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
  },
  navBtn: {
    fontSize: 13,
    fontWeight: 700,
    color: '#374151',
    background: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: 3,
    padding: '0px 6px',
    cursor: 'pointer',
    lineHeight: '18px',
  },
  navLabel: {
    fontSize: 11,
    color: '#6b7280',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 40,
    textAlign: 'center' as const,
  },
  select: {
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    outline: 'none',
    height: 22,
    maxWidth: 160,
  },
  liveWarning: {
    fontSize: 10,
    color: '#92400e',
    marginLeft: 'auto',
  },
  iframeWrap: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  iframe: {
    width: '100%',
    height: '100%',
    border: 'none',
    display: 'block',
  },
  empty: {
    position: 'absolute' as const,
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center' as const,
    padding: 16,
  },
  selectorBar: {
    height: 32,
    borderTop: '1px solid #e5e7eb',
    padding: '0 8px',
    display: 'flex',
    alignItems: 'center',
    background: '#f9fafb',
    flexShrink: 0,
    overflow: 'hidden',
  },
  selectorCode: {
    fontSize: 10,
    fontFamily: 'monospace',
    color: '#065f46',
    background: '#d1fae5',
    padding: '1px 4px',
    borderRadius: 3,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 160,
    flexShrink: 0,
  },
  capturedText: {
    fontSize: 10,
    color: '#6b7280',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    minWidth: 0,
  },
  copyBtn: {
    fontSize: 10,
    fontWeight: 600,
    color: '#fff',
    border: 'none',
    borderRadius: 3,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  hint: {
    fontSize: 10,
    color: '#9ca3af',
    fontStyle: 'italic' as const,
  },
  handle: {
    width: 8,
    height: 8,
    background: '#34d399',
    border: '2px solid #fff',
    boxShadow: '0 0 0 1px #34d399',
    borderRadius: '50%',
  },
}
