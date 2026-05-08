import { useState, useEffect, useRef, useCallback } from 'react'

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS = '/kcl-proxy/v1/models'
const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'

const HEADER_COLOR = '#881337'

const DEFAULT_SYSTEM = `You are a helpful assistant embedded in the iDAH Federation Workflow PoC — a visual, node-based pipeline editor for federating UK Arts and Humanities research data (AHRC/UKRI funded).

Users build workflows by connecting nodes on a canvas. Data flows left-to-right; output handles (green circles, right side of nodes) connect to input handles (coloured circles, left side).

KEY NODE TYPES:
• Data sources: GBIF (biodiversity), LLDS (language data, Oxford), ADS Advanced (archaeology, York), ARIADNE (European archaeology), Europeana (cultural heritage — needs API key), MDS (museum data), Local File (CSV/XML/image), Local Folder (batch PDF/XML/text/images)
• Inspection: Quick View (field inspector, CSV/image preview), Image View (images + IIIF manifests)
• Filtering: Filter/Transform (filter/cast/rename/sort/deduplicate fields), Spatial Filter (map bounding box), Reconciliation (Wikidata entity matching via OpenRefine protocol)
• Enrichment: URL Fetch (web scraping with optional JS rendering via Puppeteer), HTML Section (CSS selector or Mozilla Readability extraction), HTML Preview (visual click-to-capture selector tool), XML Section (XPath extraction)
• AI inference: KingsInference (sends each record to KCL's OpenAI-compatible API, enriches with kclResponse), KingsInferenceByField (targets a specific field; per-record or aggregate modes), Ollama / OllamaByField (local LLM via Ollama)
• Output: Table, JSON, Map (uses decimalLatitude/decimalLongitude), Timeline (ISO dates or bare years), Export (CSV/JSON/GeoJSON), KingsInferenceOutput
• Utility: Param (reusable text/integer value — wire to any text input handle), Comment, Save/Load Search, Merge by QID, Wikidata Enrich, Citation, Field Distribution

TIPS:
- Connect a Param node to an API key handle to share one key across multiple nodes
- Use "Run All" in the top bar to execute the whole pipeline in topological order
- Double-click a Table or JSON node to expand it full-screen
- Save/Load workflow as JSON to share or resume pipelines
- Results are stored out-of-band (resultsStore); only a version number is held in node data

Answer questions about the interface, suggest workflows for research tasks, explain node capabilities, and help debug pipelines.`

// ── Types ──────────────────────────────────────────────────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  error?: boolean
}

interface Props {
  isOpen: boolean
  onToggle: () => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatSidebar({ isOpen, onToggle }: Props) {
  const [apiKey, setApiKey]             = useState(() => localStorage.getItem('kcl_chat_apiKey') ?? '')
  const [model, setModel]               = useState(() => localStorage.getItem('kcl_chat_model') ?? '')
  const [systemPrompt, setSystemPrompt] = useState(() => localStorage.getItem('kcl_chat_system') ?? DEFAULT_SYSTEM)
  const [temperature, setTemperature]   = useState(0.7)
  const [maxTokens, setMaxTokens]       = useState(16384)
  const [tokenInput, setTokenInput]     = useState('16384')

  const [messages, setMessages]         = useState<Message[]>([])
  const [inputText, setInputText]       = useState('')
  const [isLoading, setIsLoading]       = useState(false)
  const [streaming, setStreaming]       = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showKey, setShowKey]           = useState(false)
  const [models, setModels]             = useState<string[]>([])
  const [apiOk, setApiOk]               = useState<boolean | null>(null)

  const abortRef      = useRef<AbortController | null>(null)
  const streamingRef  = useRef('')
  const messagesEnd   = useRef<HTMLDivElement>(null)

  // Persist config
  useEffect(() => { localStorage.setItem('kcl_chat_apiKey', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('kcl_chat_model', model) }, [model])
  useEffect(() => { localStorage.setItem('kcl_chat_system', systemPrompt) }, [systemPrompt])

  // Scroll to bottom
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // Fetch available models when key changes
  useEffect(() => {
    if (!apiKey) { setApiOk(false); setModels([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(KCL_MODELS, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json() as { data?: Array<{ id: string }> }
        if (cancelled) return
        const ids = (json.data ?? []).map(m => m.id).sort()
        setModels(ids)
        setApiOk(true)
        setModel(prev => prev || ids.find(id => id === 'arc:lite') || ids[0] || '')
      } catch {
        if (!cancelled) { setApiOk(false); setModels([]) }
      }
    })()
    return () => { cancelled = true }
  }, [apiKey])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text || isLoading || !apiKey) return

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInputText('')
    setIsLoading(true)
    setStreaming('')
    streamingRef.current = ''

    abortRef.current = new AbortController()

    try {
      const res = await fetch(KCL_CHAT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          stream:      true,
          temperature,
          max_tokens:  maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      if (!res.body) throw new Error('No response body')

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') break
          try {
            const chunk = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const content = chunk.choices?.[0]?.delta?.content
            if (content) {
              streamingRef.current += content
              setStreaming(streamingRef.current)
            }
          } catch { /* skip malformed chunk */ }
        }
      }

      const assistantMsg: Message = {
        id:      `a-${Date.now()}`,
        role:    'assistant',
        content: streamingRef.current,
      }
      setMessages(prev => [...prev, assistantMsg])
      setStreaming('')
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        const partial = streamingRef.current
        if (partial) {
          setMessages(prev => [...prev, {
            id: `a-${Date.now()}`, role: 'assistant',
            content: partial + '\n\n[cancelled]',
          }])
        }
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        setMessages(prev => [...prev, {
          id: `a-${Date.now()}`, role: 'assistant',
          content: `Error: ${msg}`, error: true,
        }])
      }
      setStreaming('')
    } finally {
      setIsLoading(false)
    }
  }, [inputText, isLoading, apiKey, model, systemPrompt, temperature, maxTokens, messages])

  const handleCancel = useCallback(() => { abortRef.current?.abort() }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  if (!isOpen) return null

  const noKey    = !apiKey
  const canSend  = !!apiKey && !!inputText.trim() && !isLoading

  return (
    <div style={styles.sidebar}>
      {/* ── Header ── */}
      <div style={styles.header}>
        <span style={styles.title}>KCL Assistant</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {apiOk === true && <span style={styles.dot} title="Connected" />}
          {apiOk === false && apiKey && <span style={{ ...styles.dot, background: '#ef4444' }} title="Cannot reach API" />}
          <button style={styles.iconBtn} onClick={() => setShowSettings(v => !v)} title="Settings">⚙</button>
          <button style={styles.iconBtn} onClick={() => setMessages([])} title="Clear conversation">🗑</button>
          <button style={styles.iconBtn} onClick={onToggle} title="Close">✕</button>
        </div>
      </div>

      {/* ── Settings panel ── */}
      {showSettings && (
        <div style={styles.settings}>
          {/* API key */}
          <div style={styles.settingRow}>
            <label style={styles.label}>Key</label>
            <input
              type={showKey ? 'text' : 'password'}
              style={{ ...styles.input, flex: 1 }}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
            <button style={styles.eyeBtn} onClick={() => setShowKey(v => !v)}>
              {showKey ? '🙈' : '👁'}
            </button>
          </div>
          {apiKey && (
            <div style={{ fontSize: 10, color: apiOk ? '#16a34a' : '#dc2626', paddingLeft: 52, marginTop: -2, marginBottom: 2 }}>
              {apiOk === null ? 'Checking…' : apiOk
                ? `✓ Connected${models.length > 0 ? ` — ${models.length} models` : ''}`
                : '✗ Cannot reach KCL API — check key or VPN'}
            </div>
          )}
          {/* Model */}
          <div style={styles.settingRow}>
            <label style={styles.label}>Model</label>
            {models.length > 0 ? (
              <select style={{ ...styles.input, flex: 1 }} value={model} onChange={e => setModel(e.target.value)}>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            ) : (
              <input style={{ ...styles.input, flex: 1 }} value={model} onChange={e => setModel(e.target.value)} placeholder="arc:lite" />
            )}
          </div>
          {/* Temp */}
          <div style={styles.settingRow}>
            <label style={styles.label}>Temp</label>
            <input type="range" min={0} max={1} step={0.05} value={temperature}
              onChange={e => setTemperature(parseFloat(e.target.value))} style={{ flex: 1 }} />
            <span style={styles.numLabel}>{temperature.toFixed(2)}</span>
          </div>
          {/* Tokens */}
          <div style={styles.settingRow}>
            <label style={styles.label}>Tokens</label>
            <input type="text" style={{ ...styles.input, width: 64 }}
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              onBlur={() => {
                const n = parseInt(tokenInput, 10)
                if (Number.isFinite(n) && n > 0) setMaxTokens(n)
                else setTokenInput(String(maxTokens))
              }}
            />
          </div>
          {/* System prompt */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={styles.label}>System</label>
              <button style={styles.resetBtn} onClick={() => setSystemPrompt(DEFAULT_SYSTEM)}>Reset</button>
            </div>
            <textarea style={styles.systemTextarea} value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)} rows={8} />
          </div>
        </div>
      )}

      {/* ── No-key banner ── */}
      {noKey && !showSettings && (
        <div style={styles.noKeyBanner}>
          ⚠ Open settings (⚙) to configure your KCL API key
        </div>
      )}

      {/* ── Messages ── */}
      <div style={styles.messages}>
        {messages.length === 0 && !streaming && (
          <div style={styles.emptyState}>
            Ask about the workflow editor, research data services, how to build pipelines, or anything else…
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} style={msg.role === 'user' ? styles.userBubble : styles.assistantBubble}>
            {msg.role === 'assistant' && (
              <div style={styles.bubbleToolbar}>
                <span style={styles.roleLabel}>Assistant</span>
                <button
                  style={styles.copyBtn}
                  onClick={() => navigator.clipboard.writeText(msg.content)}
                  title="Copy response"
                >
                  📋
                </button>
              </div>
            )}
            <div style={{
              ...styles.bubbleText,
              color: msg.error ? '#dc2626' : msg.role === 'user' ? '#fff' : '#111827',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {/* Live streaming bubble */}
        {streaming && (
          <div style={styles.assistantBubble}>
            <div style={styles.bubbleToolbar}>
              <span style={styles.roleLabel}>Assistant</span>
              <button style={styles.copyBtn} onClick={handleCancel} title="Cancel generation">✕</button>
            </div>
            <div style={styles.bubbleText}>
              {streaming}<span style={styles.cursor}>▋</span>
            </div>
          </div>
        )}

        <div ref={messagesEnd} />
      </div>

      {/* ── Input ── */}
      <div style={styles.inputArea}>
        <textarea
          style={styles.inputTextarea}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={noKey ? 'Configure API key first…' : 'Ask something… (Enter to send, Shift+Enter for newline)'}
          disabled={noKey || isLoading}
          rows={3}
        />
        <button
          style={{ ...styles.sendBtn, opacity: canSend ? 1 : 0.35, cursor: canSend ? 'pointer' : 'default' }}
          onClick={handleSend}
          disabled={!canSend}
          title="Send"
        >
          ▶
        </button>
      </div>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 340,
    flexShrink: 0,
    borderLeft: '1px solid #e5e7eb',
    background: '#fff',
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
  },
  header: {
    height: 40,
    background: HEADER_COLOR,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
    flexShrink: 0,
  },
  title: {
    color: '#fff',
    fontWeight: 700,
    fontSize: 13,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#22c55e',
    flexShrink: 0,
  },
  iconBtn: {
    background: 'none',
    border: 'none',
    color: '#fda4af',
    fontSize: 14,
    cursor: 'pointer',
    padding: '2px 4px',
    borderRadius: 4,
    lineHeight: 1,
  },
  settings: {
    padding: '10px 12px',
    background: '#fdf2f8',
    borderBottom: '1px solid #fce7f3',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flexShrink: 0,
  },
  settingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    color: '#6b7280',
    width: 44,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  input: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    outline: 'none',
    height: 22,
    background: '#fff',
  },
  eyeBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 2px',
    flexShrink: 0,
  },
  numLabel: {
    fontSize: 10,
    color: '#6b7280',
    width: 28,
    textAlign: 'right',
  },
  resetBtn: {
    fontSize: 10,
    color: '#9f1239',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  },
  systemTextarea: {
    width: '100%',
    fontSize: 10,
    padding: '4px 6px',
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'monospace',
    lineHeight: 1.4,
    boxSizing: 'border-box',
    background: '#fff',
  },
  noKeyBanner: {
    fontSize: 11,
    padding: '8px 12px',
    background: '#fef2f2',
    borderBottom: '1px solid #fecaca',
    color: '#991b1b',
    flexShrink: 0,
  },
  messages: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  emptyState: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    padding: '24px 16px',
    lineHeight: 1.6,
  },
  userBubble: {
    alignSelf: 'flex-end',
    background: '#1e3a5f',
    borderRadius: '12px 12px 2px 12px',
    padding: '8px 12px',
    maxWidth: '85%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '2px 12px 12px 12px',
    padding: '8px 12px',
    maxWidth: '95%',
    width: '100%',
    boxSizing: 'border-box',
  },
  bubbleToolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  roleLabel: {
    fontSize: 10,
    color: '#9ca3af',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  copyBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '0 2px',
    color: '#9ca3af',
    lineHeight: 1,
  },
  bubbleText: {
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  cursor: {
    animation: 'none',
    opacity: 0.7,
    color: HEADER_COLOR,
  },
  inputArea: {
    padding: '8px 10px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: 6,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  inputTextarea: {
    flex: 1,
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    outline: 'none',
    resize: 'none',
    fontFamily: 'inherit',
    lineHeight: 1.5,
    boxSizing: 'border-box',
    background: '#fff',
  },
  sendBtn: {
    background: HEADER_COLOR,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
    height: 32,
  },
}
