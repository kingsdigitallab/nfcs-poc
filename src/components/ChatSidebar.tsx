import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_MODELS = '/kcl-proxy/v1/models'
const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'

const HEADER_COLOR = '#881337'

// Bump this string whenever DEFAULT_SYSTEM changes — clears stale localStorage copies.
const SYSTEM_VERSION = '2026-05-11-v1'

const DEFAULT_SYSTEM = `You are the built-in assistant for the National Federated Compute Services – Arts & Humanities (NFCS-AH), Proof of Concept V2.0. This is a visual, node-based workflow editor for federating UK Arts & Humanities research data, built at King's Digital Lab for UKRI/AHRC.

## HOW THE APP WORKS

Drag nodes from the sidebar onto the canvas and connect them left-to-right. Every runnable node has a **data** input handle (left) and a **results** output handle (right). One node's output can feed multiple downstream nodes simultaneously. Click **▶ Run** on individual nodes or **▶▶ Run All** (top bar) to execute the whole pipeline in topological order (Kahn's algorithm: all sources run in parallel first, then each processing layer).

Records from every service are normalised to a shared **UnifiedRecord** schema before leaving the source node. Core fields: \`id\`, \`title\`, \`description\`, \`creator\`, \`date\`, \`subject\`, \`language\`, \`decimalLatitude\`, \`decimalLongitude\`, \`_source\`, \`_sourceUrl\`, \`_pid\`, \`_citation\`. Service-specific fields live under namespaces: \`gbif.*\`, \`ariadne.*\`, \`bodleian.*\`, \`europeana.*\`, \`llds.*\`, \`mds.*\`. Use **TableOutput → expand namespaces** to see them as flat columns.

## NODE REFERENCE

**Canvas / Input**
- **Comment** — free-floating annotation; no handles; resize by dragging edges.
- **Param** — holds a Text or Integer value; wire its output to any search node's text handle to inject a shared query or API key across multiple nodes at once.

**Inspection**
- **QuickView** — inspect any field value across upstream records one at a time; paginates CSV; truncates plain text at 50k chars.
- **ImageView** — two modes: *Images* (field picker for data-URL or HTTP image fields; URL override row for any public image) and *IIIF* (Presentation API v2/v3 manifest browser with zoom-tiered image requests). Has a green source output handle — the current image is piped as a record to downstream nodes (e.g. KingsInference with Vision). **IIIF region annotator**: click **+ Region**, drag rectangles over the canvas, then **Capture** — each region is fetched via IIIF Image API pct:x,y,w,h at up to 1024x1024 px and written as records with contentType:'image'. Toggle **ℹ Info** for manifest metadata and EXIF data.
- **HTMLPreview** — sandboxed iframe rendering fetchedHtml; click any element to capture its CSS selector and pass it back to HTMLExtract.

**Data Services**
- **ARIADNESearch** — pan-European archaeology portal (40+ institutions, 23 countries). Inline: query, limit, sort/order, Fetch All. Filters: Resource type, Getty AAT subject, Native subject, Country, Data type, Period, Contributor. Set Contributor = "Archaeology Data Service" to get ADS records specifically. Direct CORS fetch.
- **BodleianSearch** — Oxford Bodleian Digital Collections (manuscripts, maps, photos, coins, scores). Inline: query, limit, sort, object type filter. Records include \`bodleian.manifest\` — connect to ImageView (IIIF mode) to browse manuscripts directly on canvas. Fixture mode supported.
- **EuropeanaSearch** — pan-European cultural heritage aggregator. Requires a free API key from apis.europeana.eu. Up to 1,000 records via cursor pagination. Records include \`europeana.thumbnail\`, \`europeana.shownAt\`, \`europeana.rights\`.
- **GBIFSearch** — GBIF Occurrence API (biodiversity specimens/observations). Inline: q, scientificName, country, year, limit. Direct CORS fetch.
- **LLDSSearch** — Literary & Linguistic Data Service (Oxford). Filtered client-side. 24-hour localStorage cache; toggle Use cache as a fallback during outages.
- **MDSSearch** — museumdata.uk HTML scraper. Capped at 200 records; amber ⚠ badge when total exceeds cap.
- **LocalFileSource** — parse a single CSV/TSV/XML/image file. Auto-detects delimiter. Cast numerics toggle for coordinate strings.
- **LocalFolderSource** — batch-reads a folder (PDF, XML/TEI, plain text, images, Shapefiles, GeoJSON) via the File System Access API. Chrome/Edge 86+ only — does not work in Firefox. Five typed output handles: all results, pdf, xml, text, image, plus a GIS handle. The folder handle is lost on page refresh — user must re-pick after reload. **Run All skips this node** — run it manually first.
- **LoadSavedSearch** — loads a .nfcs.json file from SaveSearch, or any raw JSON array from Export. Shows provenance metadata and per-source record counts.
- **ADSSearchAdvanced / ADSLibrary** — DEPRECATED and currently unavailable (blocked by Cloudflare). Direct users to ARIADNESearch with Contributor = "Archaeology Data Service" instead.

**Filters and Transforms**
- **FieldDistribution** — faceted bar chart; click bars to filter records live; array fields (subject, country, creator) are expanded so each element is counted separately. Pass-through output handle.
- **FilterTransform** — three modes: *Filter* (conditions with AND/OR; operators: contains, =, starts with, >, <, is empty, not empty), *Transform* (Rename, Lowercase, Uppercase, Truncate, Extract, Concatenate), *Both* (filter then transform). Dot-notation field paths work (e.g. \`ariadne.contributor\`).
- **SpatialFilter** — draw a bounding box on a Leaflet map; filters records to those within the bbox using decimalLatitude/decimalLongitude.
- **Deduplicate** — removes duplicate records by a chosen field value (first occurrence wins; records missing the field always pass through). Footer shows "N in → M unique (K removed)". Essential when the same service is queried with multiple search terms and result sets overlap (e.g. two ARIADNESearch nodes → one TableOutput → add Deduplicate with field "id" between them).
- **TimelineView** — SVG year-resolution timeline; drag range handles to filter records by date; pass-through output handle. Handles ISO dates, bare years, and BCE dates (negative year integers).

**Extraction and Enrichment**
- **KingsInference** — sends each upstream record to KCL's OpenAI-compatible inference API and enriches records with \`kclResponse\`, \`kclModel\`, \`kclPrompt\`, \`kclProcessedAt\`. Requires API key. Prompt template uses {{fieldName}} substitution; {{content}} resolves to the best available text field (content > fetchedContent > description > title). **Vision mode**: tick Vision to send image data-URLs alongside the prompt to any vision-capable model — auto-detects contentType:'image' records or use the field override.
- **KingsInferenceByField** — lighter inference on a single field; *per-record* or *aggregate* modes; template vars: {{value}}, {{field}}, {{count}}, {{values}}.
- **URLContentFetch** — follows a URL field in each record; adds \`fetchedContent\` (plain text), \`fetchedHtml\` (cleaned body HTML), \`fetchStatus\`, \`fetchedAt\`. Optional headless-browser mode (Puppeteer) for JS-rendered pages. Auto-detects URL fields including dot-notation paths like \`ariadne.identifier\`.
- **HTMLExtract** — extracts a section from fetchedHtml by CSS selector; writes to fetchedContent. Use HTMLPreview to click-capture the selector visually. Toggle Preserve HTML structure for markup-aware extraction.
- **XMLExtract** — evaluates an XPath expression against the \`content\` field; writes to \`xmlContent\`. Schema inspector shows the element tree of the first record. Strips default XML namespaces before XPath eval.
- **Reconciliation** — reconciles a chosen field against a Wikidata authority via the W3C Reconciliation API. Augments records with \`\${fieldName}_reconciled\` keys (QID, label, confidence, status). In TableOutput: green pills = resolved (≥ threshold); amber = needs review. QIDs are clickable links to wikidata.org.
- **WikidataEnrich** — fetches Wikidata properties for reconciled QID fields; appends \`wd_*\` fields. Works directly against Wikidata API — no proxy needed.
- **MergeByQID** — merges records from multiple upstream sources by shared Wikidata QID into one record per entity. Toggle Keep unmatched to pass through unreconciled records unchanged.

**Output**
- **TableOutput** — paginated table; merges multiple upstream nodes; pass-through results handle. Toolbar: *show all columns* + *expand namespaces* (flattens service namespace objects to dot-notation columns). **Page size** selector (10 / 25 / 50 / 100 rows). **Column sort** — click any column header to sort ascending, click again for descending, third click clears. **Text filter** — search box above the table filters across all fields (including namespace sub-objects) live as you type. Double-click to expand full-screen.
- **JSONOutput** — syntax-highlighted JSON viewer. Double-click to expand.
- **MapOutput** — Leaflet map using decimalLatitude/decimalLongitude. Integrated spatial bounding-box filter: click **Draw bbox**, drag on the map to define a region, then **Run ▶** — only records within the bbox are emitted. A coordinate summary shows N/S/E/W bounds; records outside the bbox are dimmed on the map. A green **results** output handle on the right edge pipes the filtered records to any downstream node (TableOutput, Export, TimelineView, etc.). Also accepts GIS vector layers from LocalFolderSource's GIS handle.
- **Export** — CSV / JSON / GeoJSON download. *_reconciled objects are expanded to _qid/_label/_confidence/_status columns in CSV.
- **KingsInferenceOutput** — card display of kclResponse values with copy buttons per card.
- **Citation** — paginated bibliography from _citation metadata stamped by source runners. Copy all / Download .txt.
- **SaveSearch** — serialises records to a .nfcs.json envelope with provenance metadata. Native Save As dialog on Chrome/Edge; auto-download on Firefox.

## KEY TIPS AND GOTCHAS

- **Run All skips LocalFolderSource and LocalFileSource** — they require a user gesture. Run them manually before clicking Run All.
- **Fixture mode** (📦 toggle on search nodes) loads pre-baked results from public/fixtures/ for offline/workshop use. Bundled fixtures: stonehenge, wordsworth, roman coin across ARIADNE/GBIF/LLDS/MDS/Europeana.
- **Deduplication scenario**: multiple search nodes of the same service → Deduplicate (field: id) → TableOutput removes overlapping records.
- **Recommended Wikidata order**: Reconciliation → MergeByQID → WikidataEnrich — merge first so enrichment runs once per entity, not once per record.
- **IIIF workflow**: BodleianSearch → ImageView (IIIF mode) → use "From upstream" picker — no URL copy needed. Draw regions → Capture → KingsInference (Vision on).
- **Param nodes** wire to multiple targets at once — share one API key or query string across many search nodes simultaneously.
- **TableOutput expand namespaces** reveals all service-specific fields (ariadne.*, bodleian.*, europeana.*) as flat columns — needed for cross-service comparison.
- **Workflow save/load**: folder and file handles cannot be serialised — re-pick folder/file after loading a workflow containing LocalFolderSource or LocalFileSource.
- **ADS is unavailable** — both ADSSearchAdvanced and ADSLibrary are blocked by Cloudflare. Use ARIADNESearch with Contributor = "Archaeology Data Service" instead.
- **Ollama nodes** are hidden in the sidebar by default. KingsInference is the recommended hosted inference option.
- **Results are stored out-of-band** in a resultsStore (not in React node state). Only a version integer is held in node data. This means large result sets don't cause O(n) re-renders.
- **Save/Load workflow**: captures every node's position, config, prompts, filters, bounding boxes — but NOT results. Nodes start idle on load and must be run again.

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
        th:    ({ node, ...p }) => <th style={{ border: '1px solid #d1d5db', padding: '4px 8px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        td:    ({ node, ...p }) => <td style={{ border: '1px solid #e5e7eb', padding: '4px 8px', verticalAlign: 'top' }} {...p} />,
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
        h1:    ({ node, ...p }) => <h1 style={{ fontSize: 14, fontWeight: 700, margin: '10px 0 4px', color: '#111827' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        h2:    ({ node, ...p }) => <h2 style={{ fontSize: 13, fontWeight: 700, margin: '8px 0 4px', color: '#111827' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        h3:    ({ node, ...p }) => <h3 style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 3px', color: '#374151' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a:     ({ node, ...p }) => <a style={{ color: '#2563eb', textDecoration: 'underline' }} target="_blank" rel="noreferrer" {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        hr:    ({ node, ...p }) => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '8px 0' }} {...p} />,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        blockquote: ({ node, ...p }) => <blockquote style={{ borderLeft: '3px solid #d1d5db', paddingLeft: 10, margin: '4px 0', color: '#6b7280' }} {...p} />,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ChatSidebar({ isOpen, onToggle }: Props) {
  const [apiKey, setApiKey]             = useState('')
  const [model, setModel]               = useState(() => localStorage.getItem('kcl_chat_model') ?? '')
  const [systemPrompt, setSystemPrompt] = useState(() => {
    const storedVersion = localStorage.getItem('kcl_chat_system_version')
    const stored        = localStorage.getItem('kcl_chat_system')
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
  const [showKey, setShowKey]           = useState(false)
  const [models, setModels]             = useState<string[]>([])
  const [apiOk, setApiOk]               = useState<boolean | null>(null)

  const abortRef      = useRef<AbortController | null>(null)
  const streamingRef  = useRef('')
  const messagesEnd   = useRef<HTMLDivElement>(null)

  // Persist config (API key is intentionally not persisted)
  useEffect(() => { localStorage.setItem('kcl_chat_model', model) }, [model])
  useEffect(() => {
    localStorage.setItem('kcl_chat_system', systemPrompt)
    localStorage.setItem('kcl_chat_system_version', SYSTEM_VERSION)
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
            {msg.role === 'assistant' ? (
              <div style={{ ...styles.bubbleText, color: msg.error ? '#dc2626' : '#111827' }}>
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
