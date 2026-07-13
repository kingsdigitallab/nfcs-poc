# Workflow Context Accrual — Design

**Status: implemented** (refactor-v3 wave 2, tasks CA.1–CA.5) — with zero changes to
the `NodeRunner` signature, exactly as designed. Corrections discovered during
implementation, superseding the design text below where they conflict:

- **Six opt-in sites, not three.** Each LLM node duplicates its run loop in the
  component `handleRun` (components do NOT call the runner), so the `{{_lineage}}`
  spread lives in `runKCLNode`/`runOllamaNode`/`runEvaluatorNode` **and**
  `KCLNode`/`OllamaNode`/`EvaluatorNode`. Components derive lineage from
  `useNodes()`/`useEdges()` values.
- **ChatSidebar gets `nodes`/`edges` as props from App**, not via `useReactFlow` —
  there is no `ReactFlowProvider` in the tree and the sidebar renders outside
  `<ReactFlow>`. The CURRENT CANVAS section is appended to the outgoing system
  message per send only (never persisted), so `SYSTEM_VERSION` needed no bump.
- **`configFingerprint` exact staleness is deferred**: the LLM nodes bypass
  `finishRunnerSuccess`, so a stamp there would miss precisely the nodes this
  feature targets. The §7 heuristic (never-ran, or `resultsVersion` claimed with an
  empty store) is what shipped.
- **Count keys are inconsistent across runners** (reconciliation
  `resolvedCount`/`reviewCount`, geocoding bare `resolved`/`pending`/`failed`, merge
  `mergedCount`/`unmatchedCount`, search `count`); `lineageDescribers.ts` pins the
  real names and its test suite fails if a runner renames one.
- **KCLFieldNode/OllamaFieldNode are not wired** — their field-mode templates have
  their own token sets; follow-up.

Code: `src/utils/lineage.ts` (walker + narrative), `src/utils/lineageDescribers.ts`
(registry), tests in `src/__tests__/lineage.test.ts` / `lineageDescribers.test.ts`.

## 1. Problem

LLM inference nodes (KingsInference, KingsInferenceByField, Evaluator, SmartFilter,
SmartGeocoder, the Assistant panel) currently see only the records handed to them and
whatever the user types into a prompt. They have no awareness of *how those records came
to be*: which services were queried and with what search terms, which sources were
combined, what filters cut the set from 400 records to 60, which fields were renamed or
extracted, what was reconciled, merged, or geocoded along the way.

A downstream model that knows the pipeline history can:

- summarise or analyse records *in context* ("these are ARIADNE + HSDS results for
  'stonehenge', filtered to Iron Age sites with coordinates, deduplicated by title");
- explain provenance in generated narratives (SourceProfile's research assessments);
- ground the Assistant panel in the live canvas instead of static documentation;
- warn when an instruction contradicts an upstream operation (asking for records from a
  country that was filtered out two nodes ago).

Branching matters: a node's context is the history of **its own upstream subgraph**, not
of the whole canvas. Two parallel branches enriched differently must each see only their
own lineage, and a join node (MergeByQID, a multi-input TableOutput) must see both,
described as parallel contributions.

## 2. Existing building blocks

Everything needed already exists in some form; the design composes them.

| Building block | Where | What it gives us |
|---|---|---|
| `NodeRunner` signature | `src/utils/nodeRunners.ts` — `(nodeId, getNodes, edges, updateNodeData)` | Every runner already receives the full node list and resolved edge list; any node can walk its upstream subgraph at run time. **No signature change needed.** |
| Recursive upstream walk | `SaveSearchNode.collectSourceParams` (`src/nodes/SaveSearchNode.tsx`) | Proven BFS over `targetHandle === 'data'` edges capturing source-node configs via `stripTransient`. Currently component-local and leaf-sources-only — the generalised walker starts from this pattern. |
| One-hop record collection | `collectUpstreamRecords` (`src/utils/upstreamRecords.ts`) | The idiomatic home for a new multi-hop `collectLineage` (usable from runners and, via `useReactFlow`, from components). |
| Per-node "what I did" descriptors | `node.data` after each run | FilterTransform stores `filterOps[]`/`transformOps[]` + in/out counts; SmartFilter stores `generatedFilter.{conditions, explanation}`; Deduplicate stores `dedupeField`/`removedCount`; SpatialFilter stores `bbox`; Reconciliation stores field/authority/threshold/counts; MergeByQID stores merge counts; Geocoding stores config + resolved/pending/failed; KCL/Ollama store model + prompt. Search nodes store their full query config. **The lineage can be derived from what nodes already record.** |
| Per-record citation stamps | `_citation` via `citationUtils.addCitation` | service + serviceUrl + query + accessDate per record; `groupCitationsBySearch` already models "one entry per search run". |
| Structured-state → narrative | `SourceProfileNode.buildNarrativePrompt` | Working prototype of turning structured pipeline state into an LLM-ready textual summary with a token budget. |
| Central prompt substitution | `src/utils/promptTemplates.ts` | The single `renderTemplate` implementation used by every LLM node — carries a reserved `TODO(context-accrual): {{_lineage}}` marker as the injection point. |
| Results store | `src/store/resultsStore.ts` | `Map<nodeId, records>` + version counter; could host a parallel lineage sidecar if the accrue-on-run strategy were chosen (it is not — see §4). |

## 3. Lineage schema

```ts
/** One node's contribution to the pipeline history. */
interface LineageEntry {
  nodeId:    string
  nodeType:  string          // 'ariadneSearch', 'filterTransform', …
  label:     string          // sidebar label, e.g. 'ARIADNESearch'
  /** One-sentence, human-readable description of the operation.
   *  Produced by a per-node-type describer (see §5). */
  operationSummary: string
  /** The operation's key parameters, machine-readable (query strings,
   *  filter ops, field names, thresholds…). Derived from stripTransient(node.data)
   *  filtered to the keys the describer knows are meaningful. */
  params:    Record<string, unknown>
  /** Record counts when known: what came in, what went out. */
  inCount?:  number
  outCount?: number
  /** resultsVersion observed when the entry was derived — staleness signal (§7). */
  resultsVersion?: number
}

/** A node's lineage = its upstream subgraph, topologically ordered. */
interface LineageGraph {
  /** Entries in topological order (sources first). */
  entries: LineageEntry[]
  /** Edges between entries (parent nodeId → child nodeId), so branches
   *  and joins can be rendered structurally. */
  edges: Array<{ from: string; to: string }>
  /** True when any upstream node's config changed after its last run (§7). */
  stale: boolean
}
```

The graph — not a flat list — is the canonical shape. A flat narrative is *derived* from
it (§5); keeping the graph preserves branch/join structure for future consumers (a
lineage inspector UI, machine-readable export, PROV-O mapping).

## 4. Derive-on-demand vs accrue-on-run

Two candidate strategies:

| | **Derive-on-demand** (recommended) | Accrue-on-run |
|---|---|---|
| Mechanism | `collectLineage(nodeId, nodes, edges)` walks upstream `node.data` at prompt time | every runner stamps records (or a store sidecar) with a step entry as it runs |
| Runner changes | **none** — a pure utility reads existing state | all ~30 runners edited |
| Record bloat | none | per-record `_lineage` array grows down the pipeline; serialised into saves/fixtures |
| Branching | automatic — each node's upstream subgraph *is* its lineage | must merge/dedupe stamp arrays at joins |
| Freshness | reflects node config *now*; needs an explicit staleness check (§7) | reflects config *at run time*; stale configs invisible |
| Failure modes | none new (read-only walk) | partial-run stamps, ordering races in parallel waves |
| Saved workflows | works immediately on any loaded workflow (config is saved) | stamps lost unless serialised; old saves have none |

**Recommendation: derive-on-demand.** The node configs already persist in `.nfcs.json`
saves, the walk is cheap (canvases are tens of nodes, not thousands), branching falls out
of the graph structure for free, and no runner is touched. The one genuine weakness —
"config changed since the records were produced" — is handled explicitly in §7 rather
than papered over.

## 5. From graph to narrative: `lineageToNarrative`

```ts
function lineageToNarrative(graph: LineageGraph, opts?: { maxChars?: number }): string
```

- **Per-node describers.** A registry `Record<NodeTypeId, (data) => string>` produces
  `operationSummary` per node type, e.g.:
  - `ariadneSearch` → `Searched ARIADNE (pan-European archaeology portal) for "stonehenge" with filters: Country=England; retrieved 50 of 1,204 results.`
  - `filterTransform` → `Filtered records where title contains "Iron Age" (AND spatialCoverage not empty): 60 of 400 passed. Renamed field "ariadne.nativePeriod" → "period".`
  - `smartFilter` → reuse the stored `generatedFilter.explanation` verbatim (already human-readable).
  - `mergeByQID` → `Merged records from 2 sources by shared Wikidata QID: 34 entities from 88 records (unmatched kept).`
  - Unknown/undescribed node types → generic fallback: label + in/out counts.
  Describers live beside the lineage walker, NOT in node components — they read
  `node.data` only.
- **Branch rendering.** Linear chains render as a numbered list. At a join, each parent
  branch is rendered as its own indented list, then the join sentence:
  ```
  Branch A: 1. Searched ARIADNE … 2. Filtered …
  Branch B: 1. Searched HSDS …
  Then: combined branches A and B (74 records total), deduplicated by title (61 unique).
  ```
  Shared ancestors (diamond shapes) are described once, in the earliest branch that
  reaches them, and referenced by branch letter afterwards.
- **Token budget.** `maxChars` (default ~2,000 chars ≈ 500 tokens) enforced by
  precedence: keep all operation sentences; drop `params` detail first, then compress
  branches ("3 further enrichment steps") from the sources downward. Never truncate
  mid-sentence. The budget must respect the per-model limits in `kclConfig.ts`
  (`getContentMaxChars`) — the lineage shares the context window with `{{content}}`.

## 6. Prompt wiring: the `{{_lineage}}` token

- `renderTemplate(template, record)` already substitutes any `{{key}}` from its record
  argument. The integration is therefore **caller-side**: runners that opt in add
  `_lineage: lineageNarrative` to the substitution record, exactly as Evaluator adds
  `__reference`/`__candidate` today. `promptTemplates.ts` needs no signature change.
- Computation is **lazy per run, not per record**: the runner derives the narrative once
  before its record loop (`collectLineage` + `lineageToNarrative`) and reuses the string.
- UI: the prompt-template editors (KCLNode "▼ fields" token list) advertise
  `{{_lineage}}` once implemented. When absent from the template, behaviour is unchanged
  (unknown-token substitution to '' already removes it safely — but the token should
  only be advertised when populated).
- An optional "prepend pipeline context to system prompt" checkbox per LLM node is a
  simpler UX for non-template users; it concatenates the narrative to `systemPrompt`
  without touching templates.

## 7. Staleness

Derive-on-demand reads *current* config, but records in the results store were produced
by a *past* run. Detection:

- Each `LineageEntry` records the node's `resultsVersion` at derivation time.
- A cheap heuristic flags `stale: true` when an upstream node's `status` is `'idle'` (has
  config but never ran this session) or when its stored records are absent while
  downstream records exist (loaded workflow, upstream not re-run).
- For exact detection, a later enhancement can stamp `configFingerprint`
  (hash of `stripTransient(node.data)`) into node.data at run completion — a one-line
  addition to `finishRunnerSuccess` — and compare it at derivation time.
- Rendering: when `stale` is set, the narrative is prefixed with
  `Note: some upstream node settings may have changed since these records were retrieved.`
  — the LLM is told the truth rather than being lied to confidently.

## 8. ChatSidebar integration

The Assistant currently ships a static `DEFAULT_SYSTEM` describing the app. With
lineage:

- On each send, the sidebar (a component — uses `useReactFlow` for nodes/edges) derives
  lineage for **every terminal node** (nodes with no outgoing data edges) and appends a
  compact "CURRENT CANVAS" section to the system prompt: node inventory + per-terminal
  narrative + record counts.
- Budgeted separately (~1,500 chars) and versioned alongside `SYSTEM_VERSION` so cached
  localStorage prompts stay coherent.
- This turns "What node should I use next?" from a generic answer into one grounded in
  the user's actual workflow.

## 9. Implementation checklist (future pass)

1. `src/utils/lineage.ts` — `collectLineage(nodeId, nodes, edges): LineageGraph`
   (generalise the SaveSearch BFS; unit-test on hand-built graphs incl. joins/diamonds).
2. `src/utils/lineageDescribers.ts` — per-node-type describer registry
   (`satisfies Partial<Record<NodeTypeId, …>>`, same guard pattern as the other registries).
3. `lineageToNarrative(graph, opts)` + tests (branch rendering, token budget).
4. Opt-in `_lineage` substitution in the KCL/Ollama/Evaluator runners (3 call sites),
   token advertised in the field pickers.
5. ChatSidebar live-canvas section.
6. Optional: `configFingerprint` staleness stamps in `finishRunnerSuccess`.
7. Optional later: lineage inspector UI (right-click a node → "Show pipeline history"),
   PROV-O/JSON export of the `LineageGraph` alongside saved searches.

Steps 1–3 are pure utilities with no UI risk; 4 is three small caller-side changes.
Nothing requires touching the executor, the store, or the NodeRunner contract.
