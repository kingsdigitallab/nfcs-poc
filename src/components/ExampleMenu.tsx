/**
 * ExampleMenu — dropdown in the top bar listing saved example workflows.
 * Fetches /examples/manifest.json once (module-level cache), then loads
 * the selected example JSON and calls onLoad(wf) to hydrate the canvas.
 *
 * Authoring is done via the easter-egg "★ Save as Example" button in App.tsx.
 */
import { useState, useEffect, useRef } from 'react'
import type { WorkflowFile } from '../utils/workflowIO'

export interface ExampleMeta {
  slug:        string
  title:       string
  description: string
}

interface Props {
  onLoad: (wf: WorkflowFile) => void
}

let _cachedManifest: ExampleMeta[] | null = null

export function ExampleMenu({ onLoad }: Props) {
  const [open,     setOpen]     = useState(false)
  const [manifest, setManifest] = useState<ExampleMeta[] | null>(_cachedManifest)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fetch manifest when first opened
  useEffect(() => {
    if (!open || _cachedManifest) { if (_cachedManifest) setManifest(_cachedManifest); return }
    setLoading(true)
    fetch('/examples/manifest.json')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((m: ExampleMeta[]) => { _cachedManifest = m; setManifest(m) })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open])

  async function handleSelect(slug: string) {
    setLoadingSlug(slug)
    try {
      const r = await fetch(`/examples/${slug}.json`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const wf: WorkflowFile = await r.json()
      setOpen(false)
      onLoad(wf)
    } catch (e) {
      setError(`Failed to load example: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoadingSlug(null)
    }
  }

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        style={btnStyle}
        onClick={() => { setOpen(o => !o); setError(null) }}
        title="Load a pre-built example workflow"
      >
        📚 Examples
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={dropHeaderStyle}>Example Workflows</div>

          {loading && (
            <div style={hintStyle}>Loading…</div>
          )}

          {error && (
            <div style={{ ...hintStyle, color: '#fca5a5' }}>{error}</div>
          )}

          {manifest && manifest.length === 0 && (
            <div style={hintStyle}>No examples saved yet.</div>
          )}

          {manifest && manifest.map(ex => (
            <button
              key={ex.slug}
              style={itemStyle}
              onClick={() => handleSelect(ex.slug)}
              disabled={loadingSlug === ex.slug}
              title={ex.description}
            >
              <span style={itemTitleStyle}>
                {loadingSlug === ex.slug ? '…' : '▶'} {ex.title}
              </span>
              {ex.description && (
                <span style={itemDescStyle}>{ex.description}</span>
              )}
            </button>
          ))}

          <div style={{ ...hintStyle, borderTop: '1px solid #2d3348', paddingTop: 8, marginTop: 4 }}>
            Loading an example replaces the current canvas.
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  background: '#f3f4f6', color: '#33302a', border: '1px solid #d6ccb5',
  borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const dropdownStyle: React.CSSProperties = {
  position:  'absolute',
  top:       'calc(100% + 4px)',
  right:     0,
  zIndex:    9999,
  background: '#1e2130',
  border:    '1px solid #2d3348',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  minWidth:  300,
  maxWidth:  400,
  maxHeight: 420,
  overflowY: 'auto',
  fontFamily: 'system-ui, sans-serif',
}

const dropHeaderStyle: React.CSSProperties = {
  padding:    '8px 12px 6px',
  fontSize:   11,
  fontWeight: 700,
  color:      '#94a3b8',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  borderBottom: '1px solid #2d3348',
}

const hintStyle: React.CSSProperties = {
  padding:  '8px 12px',
  fontSize: 11,
  color:    '#8a8168',
  fontStyle: 'italic',
}

const itemStyle: React.CSSProperties = {
  display:    'flex',
  flexDirection: 'column',
  gap:        2,
  width:      '100%',
  background: 'none',
  border:     'none',
  borderBottom: '1px solid #252840',
  padding:    '8px 12px',
  textAlign:  'left',
  cursor:     'pointer',
  color:      '#e2e8f0',
}

const itemTitleStyle: React.CSSProperties = {
  fontSize:   12,
  fontWeight: 600,
}

const itemDescStyle: React.CSSProperties = {
  fontSize: 11,
  color:    '#8a8168',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
