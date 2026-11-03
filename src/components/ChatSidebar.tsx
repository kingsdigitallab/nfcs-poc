import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Edge, Node } from '@xyflow/react'
import { filterKCLModels, DEFAULT_KCL_API_KEY } from '../utils/kclConfig'
import { STORAGE_KEYS } from '../config/storageKeys'
import { collectLineage, lineageToNarrative } from '../utils/lineage'
import { describeNode } from '../utils/lineageDescribers'
import { SIDEBAR_ITEMS } from '../config/sidebarItems'
import { DEFAULT_SYSTEM, SYSTEM_VERSION } from '../config/assistantPrompt'

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS = '/kcl-proxy/v1/models'
const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'

const HEADER_COLOR = '#7a2f2f'

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
  /** Live canvas state, passed as props from App (there is no ReactFlowProvider
   *  above this component, so useReactFlow/useNodes are not available here). */
  nodes: Node[]
  edges: Edge[]
}

// ── Live canvas grounding ──────────────────────────────────────────────────────
// Appended to the outgoing system message on each send — NOT persisted into the
// localStorage-cached systemPrompt, so SYSTEM_VERSION needs no bump.

const CANVAS_CONTEXT_BUDGET = 1500
const DATA_TARGET_HANDLES = new Set(['data', 'results'])
const LABEL_BY_TYPE = new Map<string, string>(SIDEBAR_ITEMS.map(i => [i.type as string, i.label]))
const NON_PIPELINE_TYPES = new Set(['comment', 'param', 'group', 'quickStart'])

function buildCanvasContext(nodes: Node[], edges: Edge[]): string {
  const pipelineNodes = nodes.filter(n => !NON_PIPELINE_TYPES.has(n.type ?? ''))
  if (pipelineNodes.length === 0) return ''

  const countByLabel = new Map<string, number>()
  for (const n of pipelineNodes) {
    const label = LABEL_BY_TYPE.get(n.type ?? '') ?? n.type ?? '?'
    countByLabel.set(label, (countByLabel.get(label) ?? 0) + 1)
  }
  const inventory = [...countByLabel.entries()]
    .map(([label, count]) => (count > 1 ? `${count}× ${label}` : label))
    .join(', ')

  // Terminal nodes: receive data but feed nothing further — pipeline endpoints.
  const dataEdges = edges.filter(e => DATA_TARGET_HANDLES.has(e.targetHandle ?? ''))
  const sources = new Set(dataEdges.map(e => e.source))
  const targets = new Set(dataEdges.map(e => e.target))
  const terminals = pipelineNodes.filter(n => targets.has(n.id) && !sources.has(n.id))

  const blocks = [`CURRENT CANVAS (live workflow state, derived just now):\nNodes: ${inventory}.`]
  const shown = terminals.slice(0, 3)
  shown.forEach((t, i) => {
    const narrative = lineageToNarrative(collectLineage(t.id, nodes, edges), { maxChars: 380 })
    const label = LABEL_BY_TYPE.get(t.type ?? '') ?? t.type
    blocks.push(`Pipeline ${i + 1} — ends at ${label} (${describeNode(t)})\n${narrative || '(no upstream steps recorded)'}`)
  })
  if (terminals.length > shown.length) {
    blocks.push(`(+${terminals.length - shown.length} further pipeline endpoints not shown)`)
  }

  // Budget: drop trailing pipeline blocks whole; the inventory line always stays.
  while (blocks.join('\n\n').length > CANVAS_CONTEXT_BUDGET && blocks.length > 1) blocks.pop()
  return `\n\n${blocks.join('\n\n')}`
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

// Signals to the code component that it is nested inside a pre (block code).
const InsidePre = createContext(false)

function MdContent({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        table: ({ node, ...p }) => <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, margin: '6px 0', display: 'block', overflowX: 'auto' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        thead: ({ node, ...p }) => <thead style={{ background: '#f3f4f6' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        th:    ({ node, ...p }) => <th style={{ border: '1px solid #d6ccb5', padding: '4px 8px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        td:    ({ node, ...p }) => <td style={{ border: '1px solid #ece3d0', padding: '4px 8px', verticalAlign: 'top' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        pre:   ({ node, ...p }) => (
          <InsidePre.Provider value={true}>
            <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: '8px 10px', borderRadius: 6, overflowX: 'auto', fontSize: 10, lineHeight: 1.5, margin: '6px 0' }} {...p} />
          </InsidePre.Provider>
        ),
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        code:  ({ node, className, children: c, ...p }) => {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          const inPre = useContext(InsidePre)
          if (inPre) {
            // Block code — inherit dark pre colours; no extra background
            return <code className={className} style={{ background: 'transparent', padding: 0, fontSize: 'inherit', fontFamily: 'monospace' }} {...p}>{c}</code>
          }
          // Inline code
          return <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3, fontSize: '0.9em', fontFamily: 'monospace' }} {...p}>{c}</code>
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        p:     ({ node, ...p }) => <p style={{ margin: '4px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ul:    ({ node, ...p }) => <ul style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ol:    ({ node, ...p }) => <ol style={{ paddingLeft: 18, margin: '4px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        li:    ({ node, ...p }) => <li style={{ margin: '2px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        h1:    ({ node, ...p }) => <h1 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 4px', color: '#2c2a24' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        h2:    ({ node, ...p }) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 4px', color: '#2c2a24' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        h3:    ({ node, ...p }) => <h3 style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 3px', color: '#33302a' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a:     ({ node, ...p }) => <a style={{ color: '#2563eb', textDecoration: 'underline' }} target="_blank" rel="noreferrer" {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        hr:    ({ node, ...p }) => <hr style={{ border: 'none', borderTop: '1px solid #ece3d0', margin: '8px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid #d6ccb5', paddingLeft: 10, margin: '4px 0', color: '#8a8168' }} {...p} />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatSidebar({ isOpen, onToggle, nodes, edges }: Props) {
  const apiKey                          = DEFAULT_KCL_API_KEY
  const [model, setModel]               = useState(() => localStorage.getItem(STORAGE_KEYS.CHAT_MODEL) ?? '')
  const [systemPrompt, setSystemPrompt] = useState(() => {
    const storedVersion = localStorage.getItem(STORAGE_KEYS.CHAT_SYSTEM_VERSION)
    const stored        = localStorage.getItem(STORAGE_KEYS.CHAT_SYSTEM_PROMPT)
    return (storedVersion === SYSTEM_VERSION && stored) ? stored : DEFAULT_SYSTEM
  })
  const [temperature, setTemperature]   = useState(0.7)
  const [maxTokens, setMaxTokens]       = useState(16384)
  const [tokenInput, setTokenInput]     = useState('16384')

  const [messages, setMessages]         = useState<Message[]>([])
  const [inputText, setInputText]       = useState('')
  const [isLoading, setIsLoading]       = useState(false)
  const [streaming, setStreaming]       = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [models, setModels]             = useState<string[]>([])
  const [apiOk, setApiOk]               = useState<boolean | null>(null)

  const abortRef      = useRef<AbortController | null>(null)
  const streamingRef  = useRef('')
  const messagesEnd   = useRef<HTMLDivElement>(null)

  // Persist config (API key is intentionally not persisted)
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.CHAT_MODEL, model) }, [model])
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.CHAT_SYSTEM_PROMPT, systemPrompt)
    localStorage.setItem(STORAGE_KEYS.CHAT_SYSTEM_VERSION, SYSTEM_VERSION)
  }, [systemPrompt])

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
        const ids = filterKCLModels((json.data ?? []).map(m => m.id)).sort()
        setModels(ids)
        setApiOk(true)
        setModel(prev => prev || ids.find(id => id === 'arc:lite') || ids[0] || '')
      } catch {
        if (!cancelled) { setApiOk(false); setModels([]) }
      }
    })()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
            { role: 'system', content: systemPrompt + buildCanvasContext(nodes, edges) },
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
  }, [inputText, isLoading, apiKey, model, systemPrompt, temperature, maxTokens, messages, nodes, edges])

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
        <span style={styles.title}>Node assistant</span>
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
          {/* API key — display-only, never shows the actual value */}
          <div style={styles.settingRow}>
            <label style={styles.label}>Key</label>
            <span style={{ ...styles.input, flex: 1,
              color: apiKey ? '#15803d' : '#dc2626',
              background: apiKey ? '#f0fdf4' : '#fef2f2',
              userSelect: 'none',
            }}>
              {apiKey ? '🔒 Configured' : '⚠ Not set'}
            </span>
          </div>
          <div style={{ fontSize: 10, color: apiOk ? '#16a34a' : '#dc2626', paddingLeft: 52, marginTop: -2, marginBottom: 2 }}>
            {apiKey
              ? (apiOk === null ? 'Checking…' : apiOk
                  ? `✓ Connected${models.length > 0 ? ` — ${models.length} models` : ''}`
                  : '✗ Cannot reach KCL API — check VPN connection')
              : 'No API key — rebuild with VITE_KCL_API_KEY set'}
          </div>
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
            {msg.role === 'assistant' ? (
              <div style={{ ...styles.bubbleText, color: msg.error ? '#dc2626' : '#2c2a24' }}>
                <MdContent>{msg.content}</MdContent>
              </div>
            ) : (
              <div style={{ ...styles.bubbleText, color: '#fff' }}>{msg.content}</div>
            )}
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
              <MdContent>{streaming}</MdContent>
              <span style={styles.cursor}>▋</span>
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
    borderLeft: '1px solid #ece3d0',
    background: '#f8f3e9',
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
    fontWeight: 600,
    fontSize: 13,
    fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
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
    color: '#8a8168',
    width: 44,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  input: {
    fontSize: 11,
    padding: '2px 5px',
    border: '1px solid #ece3d0',
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
    color: '#8a8168',
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
    border: '1px solid #ece3d0',
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
    color: '#a79f8a',
    textAlign: 'center',
    padding: '24px 16px',
    lineHeight: 1.6,
    fontFamily: "'Spectral', Georgia, 'Times New Roman', serif",
    fontStyle: 'italic',
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
    background: '#faf6ec',
    border: '1px solid #ece3d0',
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
    color: '#b0a891',
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
    color: '#b0a891',
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
    borderTop: '1px solid #ece3d0',
    display: 'flex',
    gap: 6,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  inputTextarea: {
    flex: 1,
    fontSize: 12,
    padding: '6px 8px',
    border: '1px solid #d6ccb5',
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
