/**
 * FixturePreflightPanel — dev-only utility for bulk offline fixture generation.
 *
 * Accessible via the "⚙ Preflight" button in the toolbar (only rendered in
 * dev mode via import.meta.env.DEV). Iterates over fixture-capable services
 * and query terms, runs each live runner programmatically, then POSTs the
 * results to the Vite dev middleware at /dev/write-fixture to persist them
 * to public/fixtures/ without triggering browser downloads.
 */
import { useState, useCallback } from 'react'
import { nodeRunners } from '../utils/nodeRunners'
import { getNodeResults, clearNodeResults } from '../store/resultsStore'
import { fixtureFilename } from '../utils/fixtureUtils'
import { DEFAULT_EUROPEANA_API_KEY } from '../utils/kclConfig'

// Each service entry: the runner key, a display label, and any extra node data
// fields required by that service's runner (e.g. API keys).
// inlineQ covers GBIF; inlineQuery covers everything else.
// ADS Search (adsSearchAdvanced) is intentionally excluded — it uses a Puppeteer
// Cloudflare bypass that is not suitable for programmatic preflight generation.
const PREFLIGHT_SERVICES = [
  { nodeType: 'gbifSearch',      label: 'GBIF',      extra: {} },
  { nodeType: 'lldsSearch',      label: 'LLDS',      extra: {} },
  { nodeType: 'mdsSearch',       label: 'MDS',       extra: {} },
  { nodeType: 'ariadneSearch',   label: 'ARIADNE',   extra: {} },
  { nodeType: 'europeanaSearch', label: 'Europeana', extra: { apiKey: DEFAULT_EUROPEANA_API_KEY } },
  { nodeType: 'bodleianSearch',  label: 'Bodleian',  extra: {} },
  { nodeType: 'smgSearch',       label: 'SMG',       extra: {} },
  { nodeType: 'vaSearch',        label: 'V&A',       extra: {} },
  { nodeType: 'hsdsSearch',      label: 'HSDS',      extra: {} },
] as const

const DEFAULT_TERMS = 'roman coin\nstonehenge\nwordsworth'

type ServiceType = typeof PREFLIGHT_SERVICES[number]['nodeType']

export function FixturePreflightPanel() {
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState(DEFAULT_TERMS)
  const [enabled, setEnabled] = useState<Record<ServiceType, boolean>>(
    () => Object.fromEntries(PREFLIGHT_SERVICES.map(s => [s.nodeType, true])) as Record<ServiceType, boolean>,
  )
  const [log, setLog] = useState<string[]>([])
  const [running, setRunning] = useState(false)

  const appendLog = (msg: string) => setLog(l => [...l, msg])

  const handleGenerate = useCallback(async () => {
    const queryList = terms.split('\n').map(t => t.trim()).filter(Boolean)
    if (queryList.length === 0) { appendLog('✗ No query terms'); return }

    setRunning(true)
    setLog([`Starting: ${queryList.length} term(s) × ${PREFLIGHT_SERVICES.filter(s => enabled[s.nodeType]).length} service(s)…`])

    for (const term of queryList) {
      for (const { nodeType, label, extra } of PREFLIGHT_SERVICES) {
        if (!enabled[nodeType]) continue

        const syntheticId = `preflight-${nodeType}`
        // Set both inlineQuery and inlineQ so the runner's resolve() helper
        // finds the query regardless of which field name the service uses.
        const syntheticNode = {
          id:       syntheticId,
          type:     nodeType,
          position: { x: 0, y: 0 },
          data: {
            inlineQuery:     term,
            inlineQ:         term,
            inlineLimit:     '50',
            fetchAll:        false,
            useFixture:      false,
            useCache:        false,
            status:          'idle',
            statusMessage:   '',
            count:           0,
            ...extra,
          },
        }

        appendLog(`⏳ ${label} / "${term}"…`)

        try {
          await nodeRunners[nodeType](
            syntheticId,
            () => [syntheticNode as unknown as import('@xyflow/react').Node],
            [],
            () => { /* no-op: we don't need live node data updates */ },
          )

          // getNodeResults returns undefined when the runner ended with an error
          // and never called setNodeResults — guard before accessing .length
          const records = getNodeResults(syntheticId) ?? []
          if (records.length === 0) {
            appendLog(`⚠ ${label} / "${term}" — 0 records (service may be unavailable)`)
          } else {
            const filename = fixtureFilename(nodeType, term)
            const res = await fetch('/dev/write-fixture', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ filename, records }),
            })
            if (res.ok) {
              appendLog(`✓ ${label} / "${term}" — ${records.length} records → ${filename}`)
            } else {
              appendLog(`✗ ${label} / "${term}" — write failed: HTTP ${res.status}`)
            }
          }
        } catch (err) {
          appendLog(`✗ ${label} / "${term}" — ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          clearNodeResults(syntheticId)
        }
      }
    }

    appendLog('Done.')
    setRunning(false)
  }, [terms, enabled])

  if (!open) {
    return (
      <button
        style={styles.trigger}
        onClick={() => setOpen(true)}
        title="Bulk-generate offline fixtures for all data services"
      >
        ⚙ Preflight
      </button>
    )
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>⚙ Fixture Preflight</span>
        <button style={styles.closeBtn} onClick={() => setOpen(false)}>✕</button>
      </div>

      <div style={styles.body}>
        <label style={styles.label}>Query terms (one per line)</label>
        <textarea
          style={styles.textarea}
          value={terms}
          onChange={e => setTerms(e.target.value)}
          rows={4}
          className="nodrag"
        />

        <label style={styles.label}>Services</label>
        <div style={styles.serviceGrid}>
          {PREFLIGHT_SERVICES.map(({ nodeType, label }) => (
            <label key={nodeType} style={styles.checkItem} className="nodrag">
              <input
                type="checkbox"
                checked={enabled[nodeType]}
                onChange={e => setEnabled(prev => ({ ...prev, [nodeType]: e.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>

        <button
          style={{ ...styles.runBtn, opacity: running ? 0.6 : 1 }}
          onClick={handleGenerate}
          disabled={running}
          className="nodrag"
        >
          {running ? '⏳ Generating…' : '▶ Generate All'}
        </button>

        {log.length > 0 && (
          <div style={styles.log}>
            {log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith('✗') ? '#ef4444' : line.startsWith('⚠') ? '#f59e0b' : line.startsWith('✓') ? '#22c55e' : '#b0a891' }}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    background: '#f3f4f6', color: '#33302a', border: '1px solid #d6ccb5', borderRadius: 6,
    padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  panel: {
    position: 'fixed', top: 48, right: 16, zIndex: 9999,
    background: '#1e2130', color: '#e2e8f0', borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)', width: 320,
    fontFamily: 'system-ui, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', borderBottom: '1px solid #2d3348',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14,
  },
  body: {
    padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
  },
  label: {
    fontSize: 11, color: '#94a3b8', fontWeight: 600, letterSpacing: '0.04em',
  },
  textarea: {
    width: '100%', fontSize: 11, fontFamily: 'monospace', background: '#0f1117',
    color: '#e2e8f0', border: '1px solid #2d3348', borderRadius: 4,
    padding: '4px 6px', resize: 'vertical' as const, boxSizing: 'border-box',
  },
  serviceGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px',
  },
  checkItem: {
    display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer',
    color: '#cbd5e1',
  },
  runBtn: {
    background: '#312e81', color: '#fff', border: 'none', borderRadius: 5,
    padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%',
  },
  log: {
    fontSize: 10, fontFamily: 'monospace', background: '#0f1117',
    border: '1px solid #2d3348', borderRadius: 4, padding: '6px 8px',
    maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2,
  },
}
