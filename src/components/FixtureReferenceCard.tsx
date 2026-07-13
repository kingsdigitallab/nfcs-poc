/**
 * FixtureReferenceCard — quick-reference panel listing every offline fixture
 * available in public/fixtures/. Reads manifest.json once and caches it.
 * Visible to all users (not dev-only) so workshop participants can see what
 * search terms are available before going offline.
 *
 * Clicking a ✓ tick calls onPick(service, slug) so the parent can instantiate
 * the matching search node with the cached results pre-loaded.
 */
import { useState, useEffect } from 'react'

const SERVICE_LABELS: Record<string, string> = {
  ariadneSearch:   'ARIADNE',
  bodleianSearch:  'Bodleian',
  europeanaSearch: 'Europeana',
  gbifSearch:      'GBIF',
  hsdsSearch:      'HSDS',
  lldsSearch:      'LLDS',
  mdsSearch:       'MDS',
  smgSearch:       'SMG',
  vaSearch:        'V&A',
}

// Slug → display label: "roman-coin" → "roman coin"
const slugToLabel = (s: string) => s.replace(/-/g, ' ')

type Manifest = Record<string, string[]>

let _cached: Manifest | null = null

export function FixtureReferenceCard({ onPick }: { onPick: (service: string, slug: string) => void }) {
  const [open, setOpen]         = useState(false)
  const [manifest, setManifest] = useState<Manifest | null>(_cached)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (!open || _cached) { if (_cached) setManifest(_cached); return }
    fetch('/fixtures/manifest.json')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((m: Manifest) => { _cached = m; setManifest(m) })
      .catch(e => setError(String(e)))
  }, [open])

  if (!open) {
    return (
      <button style={styles.trigger} onClick={() => setOpen(true)} title="Show available cached search results">
        📦 Cached searches
      </button>
    )
  }

  // Collect all unique terms across all services (sorted)
  const allTerms = manifest
    ? [...new Set(Object.values(manifest).flat())].sort()
    : []

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>📦 Cached searches</span>
        <button style={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
      </div>

      <div style={styles.body}>
        {error && <div style={{ color: '#ef4444', fontSize: 11 }}>Failed to load manifest: {error}</div>}

        {manifest && (
          <>
            <p style={styles.hint}>
              Click a <strong>✓</strong> to add that search node to the canvas with its cached results loaded.
            </p>

            {/* Term × service grid */}
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={{ ...styles.th, textAlign: 'left' }}>Term</th>
                    {Object.keys(SERVICE_LABELS)
                      .filter(k => manifest[k])
                      .map(k => (
                        <th key={k} style={styles.th} title={k}>{SERVICE_LABELS[k]}</th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {allTerms.map(slug => (
                    <tr key={slug} style={styles.tr}>
                      <td style={styles.termCell}>{slugToLabel(slug)}</td>
                      {Object.keys(SERVICE_LABELS)
                        .filter(k => manifest[k])
                        .map(k => (
                          <td key={k} style={styles.tick}>
                            {manifest[k]?.includes(slug)
                              ? (
                                <button
                                  style={styles.tickBtn}
                                  title={`Add ${SERVICE_LABELS[k]} "${slugToLabel(slug)}" with cached results`}
                                  onClick={() => onPick(k, slug)}
                                >✓</button>
                              )
                              : ''}
                          </td>
                        ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!manifest && !error && (
          <div style={{ color: '#94a3b8', fontSize: 11 }}>Loading…</div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    background: '#f3f4f6', color: '#33302a', border: '1px solid #d6ccb5', borderRadius: 6,
    padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  panel: {
    position: 'fixed', top: 48, right: 16, zIndex: 9999,
    background: '#1e2130', color: '#e2e8f0', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', width: 520,
    fontFamily: 'system-ui, sans-serif', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #2d3348', flexShrink: 0,
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
  },
  body: {
    padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
  },
  hint: {
    fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5,
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    borderCollapse: 'collapse', width: '100%', fontSize: 11,
  },
  th: {
    padding: '4px 6px', background: '#2d3348', color: '#94a3b8',
    fontWeight: 600, letterSpacing: '0.04em', textAlign: 'center',
    whiteSpace: 'nowrap', position: 'sticky' as const, top: 0,
  },
  tr: {
    borderBottom: '1px solid #252840',
  },
  termCell: {
    padding: '3px 6px', color: '#e2e8f0', whiteSpace: 'nowrap',
  },
  tick: {
    padding: '3px 6px', textAlign: 'center', color: '#22c55e', fontWeight: 700,
  },
  tickBtn: {
    background: 'none', border: 'none', color: '#22c55e', fontWeight: 700,
    cursor: 'pointer', padding: '2px 4px', fontSize: 12,
    borderRadius: 3, lineHeight: 1,
  },
}
