import { useState, useEffect, useRef, useCallback } from 'react'
import { useReactFlow, NodeProps } from '@xyflow/react'
import type { Node, Edge } from '@xyflow/react'
import { filterKCLModels, APEX_MODEL, DEFAULT_EUROPEANA_API_KEY } from '../utils/kclConfig'
import { newId, bumpCounterPast } from '../utils/nodeIdCounter'

// ── Types ──────────────────────────────────────────────────────────────────────

interface WorkflowPlan {
  title:       string
  summary:     string
  searchNodes: SearchNodeSpec[]
  outputNodes: OutputNodeSpec[]
  edges:       EdgeSpec[]
}

interface SearchNodeSpec {
  type:    string
  params:  Record<string, string>
  comment: { title: string; body: string }
}

interface OutputNodeSpec {
  type:    string
  comment: { title: string; body: string }
}

interface EdgeSpec {
  fromSearchIndex: number
  toOutputIndex:   number
}

export interface QuickStartNodeData {
  apiKey:           string
  model:            string
  researchQuestion: string
  plan:             WorkflowPlan | null
  planStatus:       'idle' | 'planning' | 'ready' | 'error'
  planMessage:      string
  instantiated:     boolean
  [key: string]: unknown
}

// ── Constants ──────────────────────────────────────────────────────────────────

const KCL_CHAT   = '/kcl-proxy/v1/chat/completions'
const KCL_MODELS = '/kcl-proxy/v1/models'
const HEADER_COLOR = '#0c1445'

const LAYOUT = {
  SEARCH_COL_X:    360,
  PROFILE_COL_X:   680,   // compact: search(360) + max-search-width(270) + gap(50)
  OUTPUT_COL_X:    1100,  // compact: profile(680) + profile-width(360) + gap(60)
  DEDUP_COL_X:     700,   // expanded: search_end(360+270) + gap(70)
  PROFILE_COL_X_E: 1040,  // expanded: dedup_end(700+264) + gap(76)
  OUTPUT_COL_X_E:  1470,  // expanded: profile_end(1040+360) + gap(70)
  ROW_SPACING:     480,
  COMMENT_H:       120,
  COMMENT_GAP:     10,
  COMMENT_W:       220,
}

const ID_PREFIX: Record<string, string> = {
  gbifSearch:      'gbif',
  lldsSearch:      'llds',
  mdsSearch:       'mds',
  europeanaSearch: 'europeana',
  ariadneSearch:   'ariadne',
  hsdsSearch:      'hsds',
  bodleianSearch:  'bodleian',
  smgSearch:       'smg',
  vaSearch:        'va',
  tableOutput:     'table',
  mapOutput:       'map',
  deduplicate:     'dedup',
}

const VALID_SEARCH_TYPES = new Set([
  'gbifSearch', 'lldsSearch', 'mdsSearch',
  'europeanaSearch', 'ariadneSearch', 'hsdsSearch', 'bodleianSearch', 'smgSearch', 'vaSearch',
])

const VALID_OUTPUT_TYPES = new Set(['tableOutput', 'mapOutput'])

const QUICKSTART_SYSTEM_PROMPT = `You are a workflow planning assistant for a federated UK arts and humanities research data platform.

Given a research question, output a JSON workflow plan. Output ONLY the JSON — no markdown, no explanation outside the JSON.

DATA SERVICES — domain, coverage, and best uses:

gbifSearch — Global Biodiversity Information Facility
  Domain: Natural history, species occurrence, ecology, biological specimens
  Coverage: Global; strong UK/European specimen collections from natural history museums
  Best for: Species distribution, historical specimens, ecological surveys, taxonomic research
  Params: inlineQ (text query), inlineScientificName (Latin species name), inlineCountry (ISO 2-letter code), inlineYear (e.g. "1850,1900" for range), inlineLimit

lldsSearch — Literary and Linguistic Data Service (Oxford)
  Domain: Language data, linguistic resources, historical corpora, dictionaries
  Coverage: UK-focused historical and contemporary linguistic datasets
  Best for: Language change, dialect studies, historical texts, corpus linguistics
  Params: inlineQuery, inlineLimit

mdsSearch — Museum Data Service
  Domain: UK museum collection objects — art, natural history, social history, science
  Coverage: Aggregates records from many UK local and national museums
  Best for: Museum objects, material culture, decorative arts, local collections
  Params: inlineQuery, inlineLimit

europeanaSearch — Europeana
  Domain: Pan-European cultural heritage — art, manuscripts, photographs, films, maps, music
  Coverage: Thousands of European cultural institutions; strong for French, German, Dutch, Italian, Spanish collections
  Best for: European history, art history, historical photography, cultural objects, cross-national comparison
  Params: inlineQuery, inlineLimit, typeFilter ("IMAGE"|"TEXT"|"VIDEO"|"SOUND"|"3D"|"any")

ariadneSearch — ARIADNE Archaeological Research Infrastructure (includes UK/ADS data)
  Domain: Pan-European and British archaeological research — excavation data, field surveys, grey literature, site registers, geophysical data, finds
  Coverage: Europe-wide including UK (England, Scotland, Wales); strong for Italy, Greece, France, Scandinavia; incorporates data from the UK Archaeology Data Service (ADS)
  Best for: Site/monument records, excavation archives, UK and European archaeology, historic environment data, artefact types, period-specific pan-European data
  Params: inlineQuery, inlineLimit, ariadneSubject ("Site/monument"|"Artefact"|"Coin"|"Ecofact"|"Sample"), temporal (period name e.g. "roman", "medieval", "bronze age", "iron age", "neolithic"), country ("England"|"Scotland"|"Wales"|"Italy"|"Greece"|"France")

hsdsSearch — Heritage Science Data Service
  Domain: UK heritage science records — archaeological sites, listed buildings, scheduled monuments, historic landscapes, maritime heritage
  Coverage: England, Scotland, Wales, Northern Ireland; aggregates from Historic England, Historic Environment Scotland, Cadw (Wales), and other UK heritage bodies
  Best for: Scheduled monuments, listed buildings, historic parks and gardens, maritime archaeology, UK-specific heritage records, HER (Historic Environment Record) data, built heritage
  Params: inlineQuery, inlineLimit, ariadneSubject ("Site/monument"|"Fieldwork report"|"Scientific analysis"|"Monument"), temporal (period name e.g. "roman", "medieval", "bronze age", "iron age", "neolithic"), country ("England"|"Scotland"|"Wales"|"Northern Ireland"), contributor ("Historic England"|"Historic Environment Scotland"|"Cadw")

bodleianSearch — Bodleian Libraries, University of Oxford
  Domain: Manuscripts (medieval to 20th c.), rare printed books, maps, archives, music scores, photographs
  Coverage: Oxford and UK-wide collections; strong for English medieval manuscripts, early printed books
  Best for: Medieval manuscripts, early modern printed books, historical maps, literary archives, Oxford history
  Params:
    inlineQuery — plain search terms only, e.g. psalter, Wycliffe, astrolabe (no field syntax or operators)
    inlineLimit — number of results
    fqDateFrom, fqDateTo — year integers for inclusive date range (use either or both)
    fqLanguages — filter by language, e.g. "Latin", "Hebrew", "Arabic"
    fqOrigins — filter by place of origin, e.g. "England", "France", "Italy"
    fqCompleteness — "Yes" for fully digitised only; "No" for partial only
    fqMusicalNotation — "Yes" to restrict to items with musical notation; "No" to exclude them

smgSearch — Science Museum Group (5 UK museums)
  Domain: Science, technology, medicine, industry, transport collections
  Coverage: UK national collections: Science Museum London, National Railway Museum, National Science and Media Museum, Museum of Science and Industry Manchester, Locomotion
  Best for: Industrial history, scientific instruments, railway history, computing history, medical instruments
  Params: inlineQuery, inlineLimit, searchType ("objects"|"people"|"documents"), dateFrom (year), dateTo (year)

vaSearch — Victoria and Albert Museum
  Domain: Decorative arts and design — furniture, ceramics, textiles, fashion, jewellery, metalwork, glass, photography
  Coverage: World's largest decorative arts collection; strong for British and South Asian design history
  Best for: Design history, fashion history, ceramics, textiles, applied arts, material culture
  Params: inlineQuery, inlineLimit, objectType (free-text type filter), yearFrom, yearTo

AVAILABLE OUTPUT NODES:
- tableOutput — paginated sortable table; always include one
- mapOutput — geographic map; only include when results are expected to have geographic coordinates (gbifSearch, ariadneSearch, hsdsSearch have coordinates)

REQUIRED JSON SCHEMA — output exactly this structure:
{
  "title": "<short plan title>",
  "summary": "<2-3 sentences on what this workflow retrieves and why these sources>",
  "searchNodes": [
    {
      "type": "<one of the eight search node types above>",
      "params": { "<paramKey>": "<value>" },
      "comment": { "title": "<service short name>", "body": "<1-2 sentences: why this source for this question>" }
    }
  ],
  "outputNodes": [
    { "type": "<tableOutput|mapOutput>", "comment": { "title": "<label>", "body": "<what will be shown>" } }
  ],
  "edges": [
    { "fromSearchIndex": 0, "toOutputIndex": 0 }
  ]
}

RULES:
- Choose 3–5 search nodes; always include the 2–3 most directly relevant, then add 1–2 secondary sources that may have partial coverage
- Order searchNodes from most to least relevant — the best-fit source goes first
- For secondary or lower-confidence sources, note this explicitly in comment.body (e.g. "Included as a secondary source — coverage for this specific topic may be partial")
- Always include tableOutput; add mapOutput only for geographic questions using spatial-data sources
- Default inlineLimit to "20"
- Set temporal for ariadneSearch and hsdsSearch when a period is clear (e.g. "roman", "medieval", "bronze age")
- Prefer hsdsSearch over ariadneSearch for questions specifically about UK built heritage, listed buildings, scheduled monuments, or Historic Environment Records; use both for broader UK archaeology
- For gbifSearch: prefer inlineScientificName for species-level questions, inlineQ for broader biodiversity queries
- When a question involves multiple distinct terms that work better searched separately than combined (e.g. "Iron Age hillforts in England" → two ariadneSearch nodes with inlineQuery "hillforts" and "England" separately rather than "English hillforts"), output 2 or 3 searchNodes of the same type with different params. Never exceed 3 nodes of any single type. Each must appear in at least one edge.
- Every searchNode must appear in at least one edge; every outputNode must appear in at least one edge
- Do not invent param keys not listed above`

// ── Helpers ────────────────────────────────────────────────────────────────────

function validatePlan(plan: unknown): WorkflowPlan {
  if (typeof plan !== 'object' || plan === null) throw new Error('Plan is not an object')
  const p = plan as Record<string, unknown>
  if (typeof p.title !== 'string' || !p.title) throw new Error('Missing or empty title')
  if (typeof p.summary !== 'string' || !p.summary) throw new Error('Missing or empty summary')
  if (!Array.isArray(p.searchNodes) || p.searchNodes.length === 0)
    throw new Error('searchNodes must be a non-empty array')
  if (!Array.isArray(p.outputNodes) || p.outputNodes.length === 0)
    throw new Error('outputNodes must be a non-empty array')
  if (!Array.isArray(p.edges)) throw new Error('edges must be an array')

  for (let i = 0; i < (p.searchNodes as unknown[]).length; i++) {
    const s = (p.searchNodes as Record<string, unknown>[])[i]
    if (!VALID_SEARCH_TYPES.has(s.type as string))
      throw new Error(`searchNodes[${i}].type "${s.type}" is not a valid search node type`)
    if (typeof s.params !== 'object' || s.params === null)
      throw new Error(`searchNodes[${i}].params must be an object`)
    const c = s.comment as Record<string, unknown> | undefined
    if (!c || typeof c.title !== 'string')
      throw new Error(`searchNodes[${i}].comment.title must be a string`)
  }

  for (let j = 0; j < (p.outputNodes as unknown[]).length; j++) {
    const o = (p.outputNodes as Record<string, unknown>[])[j]
    if (!VALID_OUTPUT_TYPES.has(o.type as string))
      throw new Error(`outputNodes[${j}].type "${o.type}" is not a valid output node type`)
  }

  for (let k = 0; k < (p.edges as unknown[]).length; k++) {
    const e = (p.edges as Record<string, unknown>[])[k]
    const fi = e.fromSearchIndex as number
    const ti = e.toOutputIndex as number
    if (typeof fi !== 'number' || fi < 0 || fi >= (p.searchNodes as unknown[]).length)
      throw new Error(`edges[${k}].fromSearchIndex ${fi} out of range`)
    if (typeof ti !== 'number' || ti < 0 || ti >= (p.outputNodes as unknown[]).length)
      throw new Error(`edges[${k}].toOutputIndex ${ti} out of range`)
  }

  return p as unknown as WorkflowPlan
}

function parseRaw(raw: string): WorkflowPlan {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  return validatePlan(JSON.parse(cleaned))
}

async function callKCL(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<string> {
  const res = await fetch(KCL_CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream:          false,
      temperature:     0.15,
      max_tokens:      32768,
      response_format: { type: 'json_object' },
      messages,
    }),
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  return json.choices?.[0]?.message?.content ?? ''
}

function buildSearchData(spec: SearchNodeSpec): Record<string, unknown> {
  const bases: Record<string, Record<string, unknown>> = {
    gbifSearch: {
      inlineQ: '', inlineScientificName: '', inlineCountry: '', inlineYear: '',
      inlineLimit: '20', fetchAll: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    lldsSearch: {
      inlineQuery: '', inlineLimit: '20', useCache: true,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    ariadneSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '', sort: '_score', order: 'desc',
      contributor: '',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    hsdsSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '', sort: '_score', order: 'desc',
      contributor: '',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    mdsSearch: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    },
    europeanaSearch: {
      apiKey: DEFAULT_EUROPEANA_API_KEY, inlineQuery: '', inlineLimit: '20',
      typeFilter: 'any', reusability: 'any', mediaOnly: false,
      status: 'idle', statusMessage: '', count: 0,
    },
    bodleianSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false, sort: 'relevance',
      fqCompleteness: '', fqOrigins: '', fqLanguages: '',
      fqMusicalNotation: '', fqDateFrom: '', fqDateTo: '',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    smgSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      museum: '', dateFrom: '', dateTo: '', searchType: 'objects',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
    vaSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      imagesOnly: false, yearFrom: '', yearTo: '', objectType: '', count: 0,
    },
  }
  return { ...(bases[spec.type] ?? {}), ...spec.params }
}

function buildOutputData(type: string): Record<string, unknown> {
  if (type === 'mapOutput') return { bbox: null, inputCount: 0, outputCount: 0, resultsVersion: 0 }
  return {}
}

function buildSourceProfileData(apiKey: string): Record<string, unknown> {
  return {
    apiKey,
    model:           'arc:nano',
    researchQuestion:'',
    narrative:       '',
    narrativeStatus: 'idle',
    maxTokens:       16384,
    resultsVersion:  0,
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function QuickStartNode({ id, data }: NodeProps) {
  const { updateNodeData, addNodes, addEdges, getNodes } = useReactFlow()
  const d = data as QuickStartNodeData

  const apiKey = (d.apiKey as string) || ''
  const [model, setModel]     = useState((d.model as string) || 'arc:nexus')
  const [models, setModels]   = useState<string[]>([])
  const [question, setQuestion] = useState((d.researchQuestion as string) || '')
  const abortRef = useRef<AbortController | null>(null)

  const persistModel    = useCallback((v: string) => { setModel(v);    updateNodeData(id, { model: v })    }, [id, updateNodeData])
  const persistQuestion = useCallback((v: string) => { setQuestion(v); updateNodeData(id, { researchQuestion: v }) }, [id, updateNodeData])

  const plan        = d.plan as WorkflowPlan | null
  const planStatus  = d.planStatus as QuickStartNodeData['planStatus']
  const planMessage = (d.planMessage as string) || ''
  const instantiated = d.instantiated as boolean

  // Fetch model list when API key is set
  useEffect(() => {
    if (!apiKey) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(KCL_MODELS, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        })
        if (!res.ok || cancelled) return
        const json = await res.json() as { data?: Array<{ id: string }> }
        if (cancelled) return
        const ids = filterKCLModels((json.data ?? []).map(m => m.id)).sort()
        setModels(ids)
        if (ids.length > 0 && !ids.includes(model)) {
          const nexus = ids.find(m => m === 'arc:nexus') ?? ids[0]
          persistModel(nexus)
        }
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [apiKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlan = useCallback(async () => {
    if (!apiKey || !model || !question.trim()) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    updateNodeData(id, { planStatus: 'planning', planMessage: 'Planning…', plan: null, instantiated: false })

    const sysMsg  = { role: 'system' as const,    content: QUICKSTART_SYSTEM_PROMPT }
    const userMsg = { role: 'user' as const,       content: `Research question: "${question.trim()}"` }

    try {
      const raw = await callKCL(apiKey, model, [sysMsg, userMsg], ctrl.signal)

      let parsedPlan: WorkflowPlan
      try {
        parsedPlan = parseRaw(raw)
      } catch (parseErr) {
        // Self-correction retry
        updateNodeData(id, { planMessage: 'Planning… (correcting response…)' })
        const correctionMsg = {
          role: 'user' as const,
          content: `The JSON you returned was invalid: ${(parseErr as Error).message}. Return ONLY valid JSON matching the required schema, with no markdown or extra text.`,
        }
        const raw2 = await callKCL(
          apiKey, model,
          [sysMsg, userMsg, { role: 'assistant', content: raw }, correctionMsg],
          ctrl.signal,
        )
        try {
          parsedPlan = parseRaw(raw2)
        } catch (err2) {
          const combined = `First attempt: ${(parseErr as Error).message}\nRetry: ${(err2 as Error).message}`
          updateNodeData(id, { planStatus: 'error', planMessage: combined })
          return
        }
      }

      updateNodeData(id, { plan: parsedPlan, planStatus: 'ready', planMessage: '' })
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        updateNodeData(id, { planStatus: 'error', planMessage: (err as Error).message })
      }
    }
  }, [apiKey, model, question, id, updateNodeData])

  const handleInstantiate = useCallback(() => {
    if (!plan) return
    const allNodes = getNodes()
    bumpCounterPast(allNodes.map(n => n.id))
    const qs   = allNodes.find(n => n.id === id)
    const base = qs?.position ?? { x: 0, y: 0 }

    const newNodes: Node[] = []
    const newEdges: Edge[] = []

    // ── Phase 1: group search nodes by type ──────────────────────────────────
    const typeGroups = new Map<string, number[]>()
    for (let i = 0; i < plan.searchNodes.length; i++) {
      const t = plan.searchNodes[i].type
      if (!typeGroups.has(t)) typeGroups.set(t, [])
      typeGroups.get(t)!.push(i)
    }
    const hasMultiGroup = [...typeGroups.values()].some(idxs => idxs.length > 1)

    const PROFILE_COL = hasMultiGroup ? LAYOUT.PROFILE_COL_X_E : LAYOUT.PROFILE_COL_X
    const OUTPUT_COL  = hasMultiGroup ? LAYOUT.OUTPUT_COL_X_E  : LAYOUT.OUTPUT_COL_X

    // ── Phase 2: dedup + profile nodes (one per type-group) ──────────────────
    const searchIndexToProfileId = new Map<number, string>()
    const typeToDedupId          = new Map<string, string>()

    for (const [type, indices] of typeGroups.entries()) {
      const avgRow   = indices.reduce((s, i) => s + i, 0) / indices.length
      const profileY = base.y + avgRow * LAYOUT.ROW_SPACING

      if (indices.length > 1) {
        const dedupId = newId(ID_PREFIX['deduplicate'] ?? 'dedup')
        typeToDedupId.set(type, dedupId)
        newNodes.push({
          id: dedupId, type: 'deduplicate',
          position: { x: base.x + LAYOUT.DEDUP_COL_X, y: profileY },
          data: { dedupeField: '_id', status: 'idle', statusMessage: '', inputCount: 0, outputCount: 0, removedCount: 0 },
        } as Node)
      }

      const profileId = newId('profile')
      newNodes.push({
        id: profileId, type: 'sourceProfile',
        position: { x: base.x + PROFILE_COL, y: profileY },
        data: buildSourceProfileData(apiKey),
      } as Node)

      const dedupId = typeToDedupId.get(type)
      if (dedupId) {
        newEdges.push({ id: newId('e'), source: dedupId, sourceHandle: 'results',
          target: profileId, targetHandle: 'data' } as Edge)
      }

      for (const idx of indices) searchIndexToProfileId.set(idx, profileId)
    }

    // ── Phase 3: search nodes + comment nodes ────────────────────────────────
    const searchNodeIds: string[] = []

    for (let i = 0; i < plan.searchNodes.length; i++) {
      const spec   = plan.searchNodes[i]
      const nodeId = newId(ID_PREFIX[spec.type] ?? 'node')
      const ny     = base.y + i * LAYOUT.ROW_SPACING

      newNodes.push({
        id: nodeId, type: spec.type,
        position: { x: base.x + LAYOUT.SEARCH_COL_X, y: ny },
        data: buildSearchData(spec),
      } as Node)

      const commentId = newId('comment')
      newNodes.push({
        id: commentId, type: 'comment',
        position: { x: base.x + LAYOUT.SEARCH_COL_X, y: ny - LAYOUT.COMMENT_H - LAYOUT.COMMENT_GAP },
        data:  { title: spec.comment.title, body: spec.comment.body },
        style: { width: LAYOUT.COMMENT_W, height: LAYOUT.COMMENT_H },
      } as Node)

      searchNodeIds.push(nodeId)

      // search → dedup (multi-group) or search → profile (single)
      const dedupId = typeToDedupId.get(spec.type)
      if (dedupId) {
        newEdges.push({ id: newId('e'), source: nodeId, sourceHandle: 'results',
          target: dedupId, targetHandle: 'data' } as Edge)
      } else {
        const profileId = searchIndexToProfileId.get(i)!
        newEdges.push({ id: newId('e'), source: nodeId, sourceHandle: 'results',
          target: profileId, targetHandle: 'data' } as Edge)
      }
    }

    // ── Phase 4: output nodes + comment nodes ────────────────────────────────
    const outputNodeIds: string[] = []

    for (let j = 0; j < plan.outputNodes.length; j++) {
      const spec   = plan.outputNodes[j]
      const nodeId = newId(ID_PREFIX[spec.type] ?? 'out')
      const ny     = base.y + j * LAYOUT.ROW_SPACING

      newNodes.push({
        id: nodeId, type: spec.type,
        position: { x: base.x + OUTPUT_COL, y: ny },
        data: buildOutputData(spec.type),
      } as Node)

      const commentId = newId('comment')
      newNodes.push({
        id: commentId, type: 'comment',
        position: { x: base.x + OUTPUT_COL, y: ny - LAYOUT.COMMENT_H - LAYOUT.COMMENT_GAP },
        data:  { title: spec.comment.title, body: spec.comment.body },
        style: { width: LAYOUT.COMMENT_W, height: LAYOUT.COMMENT_H },
      } as Node)

      outputNodeIds.push(nodeId)
    }

    // ── Phase 5: profile → output edges (deduplicated by pair) ───────────────
    const seenProfileOutput = new Set<string>()
    for (const spec of plan.edges) {
      const profileId = searchIndexToProfileId.get(spec.fromSearchIndex)
      const outId     = outputNodeIds[spec.toOutputIndex]
      if (!profileId || !outId) continue
      const key = `${profileId}→${outId}`
      if (seenProfileOutput.has(key)) continue
      seenProfileOutput.add(key)
      newEdges.push({ id: newId('e'), source: profileId, sourceHandle: 'results',
        target: outId, targetHandle: 'data' } as Edge)
    }

    addNodes(newNodes)
    addEdges(newEdges)
    updateNodeData(id, { instantiated: true })
  }, [plan, id, getNodes, addNodes, addEdges, updateNodeData, apiKey])

  const canPlan  = !!apiKey && !!model && question.trim().length > 0 && planStatus !== 'planning'
  const isPlanning = planStatus === 'planning'

  return (
    <div style={styles.card}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>QuickStart Planner</span>
        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
          color:      apiKey ? '#86efac' : '#fca5a5',
          background: apiKey ? 'rgba(134,239,172,0.12)' : 'rgba(252,165,165,0.12)',
          userSelect: 'none',
        }}>
          {apiKey ? '🔒 Configured' : '⚠ Not set'}
        </span>
      </div>

      <div style={styles.body}>
        {/* Research question */}
        <textarea
          value={question}
          onChange={e => persistQuestion(e.target.value)}
          placeholder="Describe your research question in plain English…"
          rows={4}
          className="nodrag"
          style={styles.textarea}
        />

        {/* Model selector */}
        {models.length > 0 ? (
          <select
            value={model}
            onChange={e => persistModel(e.target.value)}
            className="nodrag"
            style={styles.select}
          >
            {models.map(m => <option key={m} value={m}>{m}</option>)}
            {!models.includes(APEX_MODEL) && (
              <option key={APEX_MODEL} value={APEX_MODEL}>{APEX_MODEL}</option>
            )}
          </select>
        ) : (
          <input
            type="text"
            value={model}
            onChange={e => persistModel(e.target.value)}
            placeholder="arc:nexus"
            className="nodrag"
            style={styles.select}
          />
        )}

        {/* Plan button */}
        <button
          onClick={handlePlan}
          disabled={!canPlan}
          className="nodrag"
          style={{
            ...styles.btn,
            opacity:    canPlan ? 1 : 0.45,
            cursor:     canPlan ? 'pointer' : 'default',
            background: isPlanning ? '#374151' : HEADER_COLOR,
          }}
        >
          {isPlanning ? (planMessage || 'Planning…') : 'Plan'}
        </button>

        {/* Error display */}
        {planStatus === 'error' && (
          <div style={styles.error}>{planMessage}</div>
        )}

        {/* Plan preview */}
        {plan && planStatus === 'ready' && (
          <div style={styles.preview}>
            <div style={styles.previewTitle}>{plan.title}</div>
            <div style={styles.previewSummary}>{plan.summary}</div>
            <div style={styles.previewNodes}>
              {plan.searchNodes.map((s, i) => (
                <div key={i} style={styles.previewItem}>▸ {s.comment.title} <span style={styles.previewType}>({s.type})</span></div>
              ))}
              {plan.outputNodes.map((o, j) => (
                <div key={j} style={styles.previewItem}>▸ {o.comment.title} <span style={styles.previewType}>({o.type})</span></div>
              ))}
            </div>
            <div style={styles.previewMeta}>
              {plan.edges.length} connection{plan.edges.length !== 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Instantiate button */}
        {plan !== null && (
          <button
            onClick={handleInstantiate}
            disabled={instantiated}
            className="nodrag"
            style={{
              ...styles.btn,
              background: instantiated ? '#14532d' : '#065f46',
              opacity:    instantiated ? 0.6 : 1,
              cursor:     instantiated ? 'default' : 'pointer',
            }}
          >
            {instantiated ? '✓ Instantiated' : 'Instantiate'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    width: 380, background: '#111827',
    border: '1px solid #1f2937', borderRadius: 6,
    fontFamily: 'sans-serif', color: '#f9fafb', fontSize: 12,
  },
  header: {
    background: HEADER_COLOR, padding: '6px 10px',
    borderRadius: '6px 6px 0 0',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { fontWeight: 700, fontSize: 13, color: '#f9fafb' },
  body: {
    padding: '8px 10px',
    display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  textarea: {
    width: '100%', boxSizing: 'border-box' as const, resize: 'vertical' as const,
    background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
    color: '#f9fafb', fontSize: 11, padding: '5px 7px', fontFamily: 'sans-serif',
  },
  select: {
    width: '100%', boxSizing: 'border-box' as const,
    background: '#1f2937', border: '1px solid #374151', borderRadius: 3,
    color: '#f9fafb', fontSize: 10, padding: '3px 6px',
  },
  btn: {
    width: '100%', border: 'none', borderRadius: 3,
    color: '#f9fafb', fontSize: 11, fontWeight: 600 as const, padding: '6px 0',
  },
  error: {
    fontSize: 10, color: '#fca5a5', background: '#450a0a',
    borderRadius: 3, padding: '5px 8px', whiteSpace: 'pre-wrap' as const,
  },
  preview: {
    background: '#1f2937', borderRadius: 4, padding: '8px 10px',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
  },
  previewTitle:   { fontWeight: 700, fontSize: 11, color: '#f9fafb' },
  previewSummary: { fontStyle: 'italic' as const, fontSize: 10, color: '#9ca3af' },
  previewNodes:   { display: 'flex', flexDirection: 'column' as const, gap: 2, marginTop: 2 },
  previewItem:    { fontSize: 10, color: '#d1d5db' },
  previewType:    { color: '#6b7280' },
  previewMeta:    { fontSize: 9, color: '#4b5563', marginTop: 2 },
}
