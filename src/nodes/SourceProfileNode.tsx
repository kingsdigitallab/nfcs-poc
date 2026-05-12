/**
 * SourceProfileNode — shows authored schema profiles enriched with runtime
 * field statistics (population rates, sample values, completeness) for
 * upstream source records. Embeds optional KCL narrative generation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { setNodeResults } from '../store/resultsStore'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { getSourceProfile, getAllProfiles } from '../data/sourceProfiles'
import type { SourceProfile, FieldProfile } from '../data/sourceProfiles'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SourceProfileNodeData {
  apiKey: string
  model: string
  researchQuestion: string
  narrative: string
  narrativeStatus: 'idle' | 'running' | 'success' | 'error'
  resultsVersion: number
  [key: string]: unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'
const KCL_MODELS = '/kcl-proxy/v1/models'

const HEADER_COLOR = '#1f2937'

const SOURCE_COLORS: Record<string, string> = {
  ariadne:   '#78350f',
  gbif:      '#14532d',
  bodleian:  '#1e3a5f',
  europeana: '#1e1b4b',
  smg:       '#164e63',
  va:        '#3b0764',
  llds:      '#7f1d1d',
  mds:       '#713f12',
  framesense:'#1c2a3a',
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function resolveField(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.')
  let val: unknown = record
  for (const part of parts) {
    if (val == null || typeof val !== 'object') return undefined
    val = (val as Record<string, unknown>)[part]
  }
  return val
}

function formatSample(val: unknown): string {
  if (val == null) return ''
  if (Array.isArray(val)) {
    const first = val[0]
    return first != null ? String(first).slice(0, 60) : ''
  }
  return String(val).slice(0, 60)
}

function pct(n: number): string {
  if (n >= 1) return '100%'
  if (n === 0) return '0%'
  return `${Math.round(n * 100)}%`
}

function pctColor(n: number): string {
  if (n >= 0.8) return '#22c55e'
  if (n >= 0.4) return '#f59e0b'
  return '#ef4444'
}

// ── KCL streaming ─────────────────────────────────────────────────────────────

async function kclChat(
  apiKey: string,
  model: string,
  prompt: string,
  signal: AbortSignal,
  onToken: (acc: string) => void,
): Promise<string> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, stream: true, temperature: 0.4, max_tokens: 800,
      messages: [
        { role: 'system', content: 'You are a research assistant helping to assess the quality and coverage of federated cultural heritage datasets.' },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '', accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (payload === '[DONE]') return accumulated
      try {
        const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> }
        const content = chunk.choices?.[0]?.delta?.content
        if (content) { accumulated += content; onToken(accumulated) }
      } catch { /* skip malformed */ }
    }
  }
  return accumulated
}

// ── Completeness bar ──────────────────────────────────────────────────────────

function CompletenessBar({ fetched, total }: { fetched: number; total: number }) {
  const ratio = total > 0 ? Math.min(fetched / total, 1) : 0
  const pctStr = total > 0 ? `${(ratio * 100).toFixed(1)}%` : ''
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 3 }}>
        <span>{fetched.toLocaleString()} of {total > 0 ? total.toLocaleString() : '?'} retrieved</span>
        <span style={{ color: pctColor(ratio), fontWeight: 600 }}>{pctStr}</span>
      </div>
      <div style={{ height: 5, background: '#374151', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${ratio * 100}%`, background: pctColor(ratio), transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

// ── Field stats row ───────────────────────────────────────────────────────────

function FieldRow({ field, rate, samples }: { field: FieldProfile; rate: number; samples: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid #1f2937', paddingBottom: 4, marginBottom: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ width: 32, textAlign: 'right', fontSize: 10, fontWeight: 700, color: pctColor(rate), flexShrink: 0 }}>
          {pct(rate)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 11, color: '#e5e7eb', fontWeight: 500 }}>{field.label}</span>
          <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 4 }}>{field.path}</span>
        </div>
        {field.type === 'iiif' && (
          <span style={{ fontSize: 9, background: '#1e3a5f', color: '#93c5fd', padding: '1px 4px', borderRadius: 2 }}>IIIF</span>
        )}
        {field.mapsToCore && (
          <span style={{ fontSize: 9, background: '#14532d', color: '#86efac', padding: '1px 4px', borderRadius: 2 }}>core</span>
        )}
        <span style={{ fontSize: 10, color: '#4b5563' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 4, paddingLeft: 38, fontSize: 10, color: '#9ca3af' }}>
          <p style={{ margin: '0 0 3px' }}>{field.description}</p>
          {field.notes && <p style={{ margin: '0 0 3px', color: '#fbbf24' }}>↳ {field.notes}</p>}
          {samples.length > 0 && (
            <p style={{ margin: 0, fontStyle: 'italic', color: '#6b7280' }}>
              e.g. {samples.map((s, i) => <span key={i}>&ldquo;{s}&rdquo;{i < samples.length - 1 ? ', ' : ''}</span>)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Profile section ───────────────────────────────────────────────────────────

interface ProfileSectionProps {
  profile: SourceProfile
  sourceRecords: Record<string, unknown>[]
  count: number
  fieldStats: Array<{ field: FieldProfile; rate: number; samples: string[] }>
}

function ProfileSection({ profile, sourceRecords, count, fieldStats }: ProfileSectionProps) {
  const [showCorrespondences, setShowCorrespondences] = useState(false)
  const bannerColor = SOURCE_COLORS[profile.source] ?? '#374151'
  const relevantCorrespondences = profile.correspondences.filter(c => {
    const stat = fieldStats.find(fs => fs.field.path === c.field)
    return stat && stat.rate > 0
  })

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        background: bannerColor, color: '#f9fafb', padding: '6px 10px',
        borderRadius: 4, marginBottom: 6,
      }}>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{profile.label}</div>
        <div style={{ fontSize: 10, color: '#d1d5db', marginTop: 2 }}>{profile.coverage.slice(0, 120)}{profile.coverage.length > 120 ? '…' : ''}</div>
      </div>

      <CompletenessBar fetched={sourceRecords.length} total={count} />

      {profile.limitations && (
        <div style={{ fontSize: 10, color: '#fbbf24', background: '#451a03', borderRadius: 3, padding: '3px 6px', marginBottom: 6 }}>
          ⚠ {profile.limitations.slice(0, 140)}{profile.limitations.length > 140 ? '…' : ''}
        </div>
      )}

      <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Fields — sorted by population
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
        {[...fieldStats].sort((a, b) => b.rate - a.rate).map(fs => (
          <FieldRow key={fs.field.path} field={fs.field} rate={fs.rate} samples={fs.samples} />
        ))}
      </div>

      {relevantCorrespondences.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setShowCorrespondences(s => !s)}
            style={{ fontSize: 10, color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 4 }}
          >
            {showCorrespondences ? '▲' : '▼'} {relevantCorrespondences.length} cross-source correspondence{relevantCorrespondences.length > 1 ? 's' : ''}
          </button>
          {showCorrespondences && (
            <div style={{ background: '#111827', borderRadius: 3, padding: '4px 6px' }}>
              {relevantCorrespondences.map((c, i) => (
                <div key={i} style={{ fontSize: 10, color: '#9ca3af', marginBottom: 3 }}>
                  <span style={{ color: '#e5e7eb' }}>{c.field}</span>
                  {' → '}
                  <span style={{ color: '#93c5fd' }}>{c.otherSource}.{c.otherField}</span>
                  {' '}
                  <span style={{ color: c.relationship === 'join-candidate' ? '#4ade80' : c.relationship === 'direct' ? '#a78bfa' : '#9ca3af' }}>
                    [{c.relationship}]
                  </span>
                  {' — '}{c.notes}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── KCL narrative panel ───────────────────────────────────────────────────────

function buildNarrativePrompt(
  sections: ProfileSectionProps[],
  researchQ: string,
): string {
  const lines: string[] = []
  if (researchQ) {
    lines.push(`Research question: "${researchQ}"\n`)
  }
  for (const s of sections) {
    const { profile, sourceRecords, count, fieldStats } = s
    lines.push(`## ${profile.label}`)
    lines.push(`Retrieved: ${sourceRecords.length.toLocaleString()} of ${count > 0 ? count.toLocaleString() : 'unknown'} available records`)
    lines.push(`Coverage: ${profile.coverage}`)
    lines.push(`Research use: ${profile.researchUse}`)
    lines.push(`Limitations: ${profile.limitations}`)
    lines.push('\nField completeness:')
    for (const fs of [...fieldStats].sort((a, b) => b.rate - a.rate).slice(0, 12)) {
      const sampleStr = fs.samples.length > 0 ? ` — e.g. "${fs.samples[0]}"` : ''
      lines.push(`  ${fs.field.label} (${fs.field.path}): ${pct(fs.rate)}${sampleStr}`)
    }
    const activeCorrs = profile.correspondences.filter(c => {
      const fs = fieldStats.find(f => f.field.path === c.field)
      return fs && fs.rate > 0
    })
    if (activeCorrs.length > 0) {
      lines.push('\nCross-source correspondences with populated fields:')
      for (const c of activeCorrs) {
        lines.push(`  ${c.field} → ${c.otherSource}.${c.otherField} [${c.relationship}]: ${c.notes}`)
      }
    }
    lines.push('')
  }
  lines.push('Please provide:')
  lines.push('1. An assessment of data quality and completeness for this research question')
  lines.push('2. Key strengths and notable gaps in the retrieved data')
  lines.push('3. Concrete suggestions for how to use or augment this data')
  if (sections.length > 1) {
    lines.push('4. Cross-source federation opportunities based on the correspondences above')
  }
  return lines.join('\n')
}

// ── Main component ────────────────────────────────────────────────────────────

export function SourceProfileNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as SourceProfileNodeData

  const { records: rawRecords, count, connected } = useUpstreamRecords(id)
  const records = rawRecords ?? []

  // Pass-through fingerprint
  const prevFingerprintRef = useRef('')
  useEffect(() => {
    const fp = `${records.length}:${records[0]?.id ?? ''}:${records[records.length - 1]?.id ?? ''}`
    if (fp === prevFingerprintRef.current) return
    prevFingerprintRef.current = fp
    const version = setNodeResults(id, records)
    updateNodeData(id, { resultsVersion: version })
  }, [records, id, updateNodeData])

  // Detect sources present in upstream records
  const sourcesDetected = useMemo(() => {
    const seen = new Set<string>()
    for (const r of records) {
      const src = r._source as string | undefined
      if (src) seen.add(src)
    }
    return [...seen]
  }, [records])

  // Compute per-source profile sections
  const profileSections: ProfileSectionProps[] = useMemo(() => {
    return sourcesDetected.flatMap(source => {
      const profile = getSourceProfile(source)
      if (!profile) return []
      const sourceRecords = records.filter(r => r._source === source) as Record<string, unknown>[]
      const fieldStats = profile.fields.map(field => {
        const populated = sourceRecords.filter(r => {
          const val = resolveField(r, field.path)
          if (val == null || val === '') return false
          if (Array.isArray(val) && val.length === 0) return false
          return true
        })
        const rate = sourceRecords.length > 0 ? populated.length / sourceRecords.length : 0
        const samples: string[] = []
        for (const r of populated) {
          const s = formatSample(resolveField(r, field.path))
          if (s && !samples.includes(s)) samples.push(s)
          if (samples.length >= 3) break
        }
        return { field, rate, samples }
      })
      // Completeness count: single source → use upstream count; multiple sources → record count only
      const srcCount = sourcesDetected.length === 1 ? count : 0
      return [{ profile, sourceRecords, count: srcCount, fieldStats }]
    })
  }, [sourcesDetected, records, count])

  // KCL state
  const [apiKey, setApiKey] = useState((d.apiKey as string) || '')
  const [model, setModel] = useState((d.model as string) || '')
  const [models, setModels] = useState<string[]>([])
  const [showKey, setShowKey] = useState(false)
  const [researchQ, setResearchQ] = useState((d.researchQuestion as string) || '')
  const [narrative, setNarrative] = useState((d.narrative as string) || '')
  const [generating, setGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Persist KCL fields to node data
  const persistApiKey = useCallback((v: string) => {
    setApiKey(v); updateNodeData(id, { apiKey: v })
  }, [id, updateNodeData])
  const persistModel = useCallback((v: string) => {
    setModel(v); updateNodeData(id, { model: v })
  }, [id, updateNodeData])
  const persistResearchQ = useCallback((v: string) => {
    setResearchQ(v); updateNodeData(id, { researchQuestion: v })
  }, [id, updateNodeData])

  // Fetch models when API key is set
  useEffect(() => {
    if (!apiKey) return
    fetch(KCL_MODELS, { headers: { Authorization: `Bearer ${apiKey}` } })
      .then(r => r.json())
      .then((j: { data?: Array<{ id: string }> }) => {
        const ids = j.data?.map((m: { id: string }) => m.id) ?? []
        setModels(ids)
        if (!model && ids.length > 0) persistModel(ids[0])
      })
      .catch(() => { /* silently ignore */ })
  }, [apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback(async () => {
    if (!apiKey || !model || profileSections.length === 0) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setGenerating(true)
    setNarrative('')
    updateNodeData(id, { narrativeStatus: 'running', narrative: '' })
    try {
      const prompt = buildNarrativePrompt(profileSections, researchQ)
      const result = await kclChat(apiKey, model, prompt, ctrl.signal, (acc) => {
        setNarrative(acc)
      })
      setNarrative(result)
      updateNodeData(id, { narrativeStatus: 'success', narrative: result })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const msg = `Error: ${(err as Error).message}`
        setNarrative(msg)
        updateNodeData(id, { narrativeStatus: 'error', narrative: msg })
      }
    } finally {
      setGenerating(false)
    }
  }, [apiKey, model, profileSections, researchQ, id, updateNodeData])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setGenerating(false)
  }, [])

  const allProfiles = useMemo(() => getAllProfiles(), [])
  const noSourceDetected = connected && records.length > 0 && sourcesDetected.length === 0

  return (
    <div style={{
      width: 360,
      background: '#111827',
      border: '1px solid #374151',
      borderRadius: 6,
      fontFamily: 'sans-serif',
      color: '#f9fafb',
      fontSize: 12,
    }}>
      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="data"
        style={{ top: '50%', background: '#6b7280', width: 8, height: 8 }}
      />

      {/* Header */}
      <div style={{
        background: HEADER_COLOR,
        padding: '6px 10px',
        borderRadius: '6px 6px 0 0',
        fontWeight: 700,
        fontSize: 13,
        color: '#f9fafb',
      }}>
        Source Profile
      </div>

      {/* Body */}
      <div style={{ padding: '8px 10px', maxHeight: 600, overflowY: 'auto' }}>

        {!connected && (
          <div style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
            Connect a source node to inspect its schema and field statistics.
          </div>
        )}

        {connected && records.length === 0 && (
          <div style={{ color: '#6b7280', fontSize: 11, textAlign: 'center', padding: '12px 0' }}>
            No records yet — run upstream nodes first.
          </div>
        )}

        {noSourceDetected && (
          <div style={{ color: '#fbbf24', fontSize: 11, padding: '6px 0' }}>
            Records found but no <code>_source</code> field detected. Profiles not available.
          </div>
        )}

        {profileSections.map(section => (
          <ProfileSection key={section.profile.source} {...section} />
        ))}

        {/* Unrecognised sources */}
        {sourcesDetected.filter(s => !getSourceProfile(s)).map(s => (
          <div key={s} style={{ color: '#f59e0b', fontSize: 11, padding: '4px 0' }}>
            Source &ldquo;{s}&rdquo; has no authored profile.{' '}
            <span style={{ color: '#6b7280' }}>Available: {allProfiles.map(p => p.source).join(', ')}</span>
          </div>
        ))}

        {/* KCL narrative section */}
        {profileSections.length > 0 && (
          <div style={{ borderTop: '1px solid #374151', marginTop: 10, paddingTop: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              AI Narrative (KCL Inference)
            </div>

            {/* Research question */}
            <textarea
              value={researchQ}
              onChange={e => persistResearchQ(e.target.value)}
              placeholder="Research question (optional) — e.g. Bronze Age settlement patterns in eastern England"
              rows={2}
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'vertical',
                background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
                color: '#f9fafb', fontSize: 10, padding: '4px 6px', marginBottom: 4,
              }}
            />

            {/* API key */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 4 }}>
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => persistApiKey(e.target.value)}
                placeholder="KCL API key"
                style={{
                  flex: 1, background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
                  color: '#f9fafb', fontSize: 10, padding: '3px 6px',
                }}
              />
              <button
                onClick={() => setShowKey(s => !s)}
                style={{ fontSize: 10, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px' }}
              >{showKey ? '🙈' : '👁'}</button>
            </div>

            {/* Model picker */}
            {models.length > 0 && (
              <select
                value={model}
                onChange={e => persistModel(e.target.value)}
                style={{
                  width: '100%', background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
                  color: '#f9fafb', fontSize: 10, padding: '3px 6px', marginBottom: 4,
                }}
              >
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            {models.length === 0 && model && (
              <input
                type="text"
                value={model}
                onChange={e => persistModel(e.target.value)}
                placeholder="Model name"
                style={{
                  width: '100%', boxSizing: 'border-box', background: '#1f2937',
                  border: '1px solid #374151', borderRadius: 3,
                  color: '#f9fafb', fontSize: 10, padding: '3px 6px', marginBottom: 4,
                }}
              />
            )}

            {/* Generate / Stop buttons */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <button
                onClick={handleGenerate}
                disabled={generating || !apiKey || !model}
                style={{
                  flex: 1, background: generating ? '#374151' : '#1d4ed8',
                  color: '#f9fafb', border: 'none', borderRadius: 3,
                  fontSize: 11, padding: '4px 0', cursor: generating || !apiKey || !model ? 'default' : 'pointer',
                }}
              >
                {generating ? 'Generating…' : 'Generate narrative'}
              </button>
              {generating && (
                <button
                  onClick={handleStop}
                  style={{ background: '#7f1d1d', color: '#fca5a5', border: 'none', borderRadius: 3, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
                >
                  Stop
                </button>
              )}
            </div>

            {/* Narrative output */}
            {narrative && (
              <div style={{
                background: '#0f172a', border: '1px solid #1e3a5f', borderRadius: 3,
                padding: '6px 8px', fontSize: 10, color: '#cbd5e1', lineHeight: 1.6,
                whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto',
              }}>
                {narrative}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={{ top: '50%', background: '#6b7280', width: 8, height: 8 }}
      />
    </div>
  )
}
