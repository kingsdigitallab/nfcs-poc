/**
 * ExampleMenu — dropdown in the top bar listing saved example workflows.
 *
 * Reads the manifest through examplesClient (shared cache, invalidated after
 * every save/delete). Ungrouped examples are a flat list at the top; examples
 * with a `group` sit under collapsible accordion sections (open by default;
 * the collapsed set is remembered per browser). In author mode each row gets
 * a ✕ that swaps to an inline Delete / Cancel confirm — no window.confirm.
 *
 * Authoring (save) is the "★ Save as Example" dialog in TopBar.tsx.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import type { WorkflowFile } from '../utils/workflowIO'
import {
  fetchExamplesManifest, deleteExample, groupExamples, type ExampleMeta,
} from '../utils/examplesClient'
import { STORAGE_KEYS } from '../config/storageKeys'

export type { ExampleMeta } from '../utils/examplesClient'

interface Props {
  onLoad: (wf: WorkflowFile) => void
  /** Author mode (TopBar easter egg) — shows the per-example ✕ delete control. */
  authorMode?: boolean
}

function readClosedGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.EXAMPLE_GROUPS_CLOSED)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

export function ExampleMenu({ onLoad, authorMode = false }: Props) {
  const [open,     setOpen]     = useState(false)
  const [manifest, setManifest] = useState<ExampleMeta[] | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [loadingSlug,  setLoadingSlug]  = useState<string | null>(null)
  const [confirmSlug,  setConfirmSlug]  = useState<string | null>(null)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null)
  const [closed, setClosed] = useState<Set<string>>(readClosedGroups)
  const menuRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback((force = false) => {
    setLoading(true)
    fetchExamplesManifest(force)
      .then(setManifest)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // (Re)read the manifest each time the menu opens — cheap when cached, and
  // picks up a save/delete that invalidated the cache.
  useEffect(() => { if (open) refresh() }, [open, refresh])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) { setOpen(false); setConfirmSlug(null) }
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

  async function handleDelete(slug: string) {
    setDeletingSlug(slug)
    setError(null)
    try {
      await deleteExample(slug)
      setConfirmSlug(null)
      refresh(true)
    } catch (e) {
      setError(`Failed to delete example: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeletingSlug(null)
    }
  }

  function toggleGroup(name: string) {
    setClosed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      try { localStorage.setItem(STORAGE_KEYS.EXAMPLE_GROUPS_CLOSED, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  function renderItem(ex: ExampleMeta, indent = 0) {
    const busy = loadingSlug === ex.slug
    if (confirmSlug === ex.slug) {
      const deleting = deletingSlug === ex.slug
      return (
        <div key={ex.slug} style={{ ...itemStyle, paddingLeft: 12 + indent, cursor: 'default' }}>
          <span style={itemTitleStyle}>Delete "{ex.title}"?</span>
          <span style={{ display: 'flex', gap: 6, marginTop: 2 }}>
            <button style={confirmBtnStyle} onClick={() => handleDelete(ex.slug)} disabled={deleting}
              title="Remove this example's file and manifest entry">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
            <button style={cancelBtnStyle} onClick={() => setConfirmSlug(null)} disabled={deleting}>Cancel</button>
          </span>
        </div>
      )
    }
    return (
      <div
        key={ex.slug}
        role="button"
        tabIndex={0}
        style={{ ...itemStyle, paddingLeft: 12 + indent, opacity: busy ? 0.6 : 1 }}
        onClick={() => { if (!busy) handleSelect(ex.slug) }}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); handleSelect(ex.slug) } }}
        title={ex.description}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ ...itemTitleStyle, flex: 1 }}>
            {busy ? '…' : '▶'} {ex.title}
          </span>
          {authorMode && (
            <button
              style={deleteBtnStyle}
              onClick={e => { e.stopPropagation(); setConfirmSlug(ex.slug) }}
              title="Delete this example (author mode)"
              aria-label={`Delete example ${ex.title}`}
            >
              ✕
            </button>
          )}
        </span>
        {ex.description && (
          <span style={itemDescStyle}>{ex.description}</span>
        )}
      </div>
    )
  }

  const grouped = manifest ? groupExamples(manifest) : null

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        style={btnStyle}
        onClick={() => { setOpen(o => !o); setError(null); setConfirmSlug(null) }}
        title="Load a pre-built example workflow"
      >
        📚 Examples
      </button>

      {open && (
        <div style={dropdownStyle}>
          <div style={dropHeaderStyle}>Example Workflows</div>

          {loading && !manifest && (
            <div style={hintStyle}>Loading…</div>
          )}

          {error && (
            <div style={{ ...hintStyle, color: '#fca5a5' }}>{error}</div>
          )}

          {manifest && manifest.length === 0 && (
            <div style={hintStyle}>No examples saved yet.</div>
          )}

          {grouped && grouped.ungrouped.map(ex => renderItem(ex))}

          {grouped && grouped.groups.map(g => {
            const isOpen = !closed.has(g.name)
            return (
              <div key={g.name}>
                <button
                  style={groupHeaderStyle}
                  onClick={() => toggleGroup(g.name)}
                  aria-expanded={isOpen}
                  title={isOpen ? 'Collapse group' : 'Expand group'}
                >
                  <span style={{ width: 12, display: 'inline-block' }}>{isOpen ? '▾' : '▸'}</span>
                  <span style={{ flex: 1 }}>{g.name}</span>
                  <span style={groupCountStyle}>{g.items.length}</span>
                </button>
                {isOpen && g.items.map(ex => renderItem(ex, 12))}
              </div>
            )
          })}

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
  boxSizing:  'border-box',
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

const groupHeaderStyle: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        6,
  width:      '100%',
  background: '#252840',
  border:     'none',
  borderBottom: '1px solid #2d3348',
  padding:    '6px 12px',
  textAlign:  'left',
  cursor:     'pointer',
  color:      '#cbd5e1',
  fontSize:   11,
  fontWeight: 700,
  letterSpacing: '0.03em',
}

const groupCountStyle: React.CSSProperties = {
  fontSize: 10, color: '#8a8168', fontFamily: 'monospace', fontWeight: 400,
}

const deleteBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #3b4260', borderRadius: 3, color: '#fca5a5',
  fontSize: 10, lineHeight: 1, padding: '2px 5px', cursor: 'pointer', flexShrink: 0,
}

const confirmBtnStyle: React.CSSProperties = {
  background: '#b91c1c', border: '1px solid #b91c1c', borderRadius: 4, color: '#fff',
  fontSize: 11, fontWeight: 600, padding: '3px 10px', cursor: 'pointer',
}

const cancelBtnStyle: React.CSSProperties = {
  background: 'none', border: '1px solid #3b4260', borderRadius: 4, color: '#cbd5e1',
  fontSize: 11, padding: '3px 10px', cursor: 'pointer',
}
