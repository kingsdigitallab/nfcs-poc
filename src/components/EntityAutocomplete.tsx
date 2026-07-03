/**
 * EntityAutocomplete — a text input with live Wikidata entity lookup
 * (wbsearchentities, the same API behind Wikidata's own autocomplete box).
 *
 * Free text is always allowed — the dropdown is assistive, not mandatory
 * (SPARQL builder text values become CONTAINS filters). Picking a suggestion
 * calls onSelect with the entity; the caller decides what to write (usually
 * the QID). When the current value IS a QID, a resolved-label chip renders
 * next to the input so users see "Q159758 → J. M. W. Turner" instead of an
 * opaque identifier.
 *
 * The dropdown uses the same createPortal pattern as SelectableReconciledPill
 * (ReconciledCell.tsx): fixed backdrop + popover on document.body, immune to
 * React Flow's canvas zoom transform and node clipping. Like that popover, it
 * does not track canvas pan/zoom while open — backdrop click closes it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { searchEntities, fetchEntityLabels, type EntitySuggestion } from '../utils/wikidataApi'

export interface EntityOption {
  qid:          string
  label:        string
  description?: string
}

const QID_RE = /^Q\d+$/i
const PID_RE = /^P\d+$/i
const DEBOUNCE_MS = 250
const MIN_QUERY_LEN = 2

/** wikidata.org page for an entity or property id. */
function wikidataUrl(id: string): string {
  const upper = id.toUpperCase()
  return PID_RE.test(upper)
    ? `https://www.wikidata.org/wiki/Property:${upper}`
    : `https://www.wikidata.org/wiki/${upper}`
}

// ── EntityOptionPopover — portal option list (also reused by the NL-assist
//    entity report's alternates picker in SparqlSearchNode) ──────────────────

export function EntityOptionPopover({
  anchorRect,
  options,
  activeQid,
  activeIndex,
  header,
  emptyHint,
  loading,
  onPick,
  onClose,
}: {
  anchorRect:  { left: number; bottom: number; width: number }
  options:     EntityOption[]
  activeQid?:  string
  /** Keyboard-highlighted row (autocomplete); distinct from activeQid (current pick). */
  activeIndex?: number
  header?:     string
  emptyHint?:  string
  loading?:    boolean
  onPick:      (opt: EntityOption) => void
  onClose:     () => void
}) {
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={onClose} />
      <div style={{
        position:     'fixed',
        top:          anchorRect.bottom + 4,
        left:         anchorRect.left,
        zIndex:       9999,
        background:   '#fff',
        border:       '1px solid #e5e7eb',
        borderRadius: 6,
        boxShadow:    '0 4px 16px rgba(0,0,0,0.15)',
        minWidth:     Math.max(anchorRect.width, 260),
        maxWidth:     360,
        maxHeight:    220,
        overflowY:    'auto',
      }}>
        {header && (
          <div style={{ fontSize: 10, color: '#6b7280', padding: '5px 10px', borderBottom: '1px solid #f3f4f6', fontWeight: 600 }}>
            {header}
          </div>
        )}
        {loading && (
          <div style={{ fontSize: 10, color: '#9ca3af', padding: '6px 10px', fontStyle: 'italic' }}>searching…</div>
        )}
        {!loading && options.length === 0 && emptyHint && (
          <div style={{ fontSize: 10, color: '#9ca3af', padding: '6px 10px', fontStyle: 'italic' }}>{emptyHint}</div>
        )}
        {!loading && options.map((opt, i) => {
          const active = opt.qid === activeQid || i === activeIndex
          return (
            <button
              key={opt.qid}
              onClick={e => { e.stopPropagation(); onPick(opt) }}
              className="nodrag"
              style={{
                display:      'block',
                width:        '100%',
                padding:      '5px 10px',
                background:   active ? '#f5f3ff' : 'transparent',
                border:       'none',
                borderBottom: '1px solid #f9fafb',
                cursor:       'pointer',
                textAlign:    'left',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 11, color: '#111827' }}>{opt.label}</span>
                <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>{opt.qid}</span>
              </span>
              {opt.description && (
                <span style={{
                  display: 'block', fontSize: 10, color: '#6b7280',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {opt.description}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </>,
    document.body,
  )
}

// ── ResolvedEntityChip — shows the real label for a QID value ────────────────

function ResolvedEntityChip({ qid }: { qid: string }) {
  const [state, setState] = useState<{ label: string; description?: string } | 'missing' | null>(null)

  useEffect(() => {
    let cancelled = false
    setState(null)
    fetchEntityLabels([qid.toUpperCase()])
      .then(m => {
        if (cancelled) return
        const hit = m.get(qid.toUpperCase())
        setState(hit ?? 'missing')
      })
      .catch(() => { /* network error — render nothing rather than mislead */ })
    return () => { cancelled = true }
  }, [qid])

  if (state === null) return null
  if (state === 'missing') {
    return (
      <span style={{
        fontSize: 9.5, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca',
        borderRadius: 8, padding: '0 6px', flexShrink: 0, whiteSpace: 'nowrap',
      }}>
        no such entity
      </span>
    )
  }
  return (
    <a
      href={wikidataUrl(qid)}
      target="_blank"
      rel="noreferrer"
      title={state.description ?? state.label}
      className="nodrag"
      style={{
        fontSize: 9.5, color: '#4c1d95', background: '#f5f3ff', border: '1px solid #ddd6fe',
        borderRadius: 8, padding: '0 6px', flexShrink: 0, whiteSpace: 'nowrap',
        maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: 'none',
      }}
    >
      {state.label}
    </a>
  )
}

// ── EntityAutocomplete ────────────────────────────────────────────────────────

export function EntityAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  seedSuggestions,
  searchType = 'item',
  emptyHint = 'no matches',
  inputStyle,
}: {
  value:            string
  onChange:         (value: string) => void
  onSelect:         (opt: EntityOption) => void
  placeholder?:     string
  /** Shown instantly when the input is empty and focused. */
  seedSuggestions?: EntityOption[]
  searchType?:      'item' | 'property'
  emptyHint?:       string
  inputStyle?:      React.CSSProperties
}) {
  const [open, setOpen]         = useState(false)
  const [options, setOptions]   = useState<EntityOption[]>([])
  const [loading, setLoading]   = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [rect, setRect]         = useState({ left: 0, bottom: 0, width: 0 })
  const inputRef  = useRef<HTMLInputElement | null>(null)
  const abortRef  = useRef<AbortController | null>(null)
  const timerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trimmed = value.trim()
  // "Already an id" — Q-ids in item mode, P-ids in property mode.
  const isQid   = (searchType === 'property' ? PID_RE : QID_RE).test(trimmed)

  const updateRect = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ left: r.left, bottom: r.bottom, width: r.width })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setHighlight(-1)
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  // Debounced live search driven by the value.
  useEffect(() => {
    if (!open) return
    if (timerRef.current) clearTimeout(timerRef.current)

    if (!trimmed) {
      setOptions(seedSuggestions ?? [])
      setLoading(false)
      return
    }
    if (isQid || trimmed.length < MIN_QUERY_LEN) {
      setOptions([])
      setLoading(false)
      return
    }

    setLoading(true)
    timerRef.current = setTimeout(() => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      searchEntities(trimmed, { type: searchType, signal: ctrl.signal })
        .then(results => {
          if (ctrl.signal.aborted) return
          setOptions(results.map(sugToOpt))
          setHighlight(-1)
          setLoading(false)
          updateRect()
        })
        .catch(err => {
          if ((err as { name?: string }).name === 'AbortError') return
          setOptions([])
          setLoading(false)
        })
    }, DEBOUNCE_MS)

    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, open, searchType])

  // Abort in-flight work on unmount.
  useEffect(() => () => { abortRef.current?.abort(); if (timerRef.current) clearTimeout(timerRef.current) }, [])

  const pick = useCallback((opt: EntityOption) => {
    onSelect(opt)
    close()
  }, [onSelect, close])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setHighlight(h => {
        const n = options.length
        if (n === 0) return -1
        return ((h + delta) % n + n) % n
      })
    } else if (e.key === 'Enter' && highlight >= 0 && options[highlight]) {
      e.preventDefault()
      e.stopPropagation()
      pick(options[highlight])
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // Never let React Flow interpret these as node deletion while typing.
      e.stopPropagation()
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        style={{
          flex: 1, fontSize: 11, padding: '2px 5px',
          border: '1px solid #d1d5db', borderRadius: 4, outline: 'none', minWidth: 0, height: 22,
          ...inputStyle,
        }}
        value={value}
        onChange={e => { onChange(e.target.value); if (!open) { updateRect(); setOpen(true) } }}
        onFocus={() => { updateRect(); setOpen(true) }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="nodrag"
      />
      {isQid && <ResolvedEntityChip qid={trimmed} />}
      {open && (loading || options.length > 0 || (trimmed.length >= MIN_QUERY_LEN && !isQid)) && (
        <EntityOptionPopover
          anchorRect={rect}
          options={options}
          activeIndex={highlight}
          emptyHint={emptyHint}
          loading={loading}
          onPick={pick}
          onClose={close}
        />
      )}
    </>
  )
}

function sugToOpt(s: EntitySuggestion): EntityOption {
  return { qid: s.id, label: s.label, description: s.description }
}
