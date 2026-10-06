# Engineering review — consolidation hand-over

**Date:** 6 October 2026
**Branch:** `chore/consolidation-guardrails` (15 commits on top of `main` 4ab18ca)
**Audience:** engineers joining the funded consolidation phase who did not build the PoC.

This document records what the codebase looks like at hand-over, what the guardrails
branch fixed, what it deliberately did not touch, and the order in which the remaining
work is worth doing. `CLAUDE.md` is the detailed architecture reference and stays the
source of truth for how the pieces fit; `CONTRIBUTING.md` holds the working rules.

---

## 1. How the app fits together (one page)

The app is a node-based workflow editor. A user drags nodes from a sidebar onto a React
Flow canvas, wires them, and runs them. Each node is a React component for its UI and,
if it does work, a *runner* function that does the work. Records flow between nodes as
`UnifiedRecord` objects.

```
Sidebar ─drag─► Canvas (React Flow, src/App.tsx)
                   │
                   │ node.type ─► four registries keyed by NodeTypeId
                   │     src/nodes/index.ts        component per type (the master list)
                   │     src/utils/nodeRunners.ts   runner per runnable type
                   │     src/config/nodeDefaults.ts factory: initial node.data per type
                   │     src/config/sidebarItems.ts palette entry per type
                   │
   Run / Run All ──► src/utils/runWorkflow.ts   Kahn's algorithm over runnable nodes;
                   │                              waves run in parallel; a failed upstream
                   │                              skips its dependants
                   ▼
            runner(nodeId, getNodes, edges, updateNodeData)
                   │  reads config from node.data and upstream records from the store
                   │  (src/utils/upstreamRecords.ts, following 'data'/'results' edges)
                   ▼
            src/store/resultsStore.ts   records live HERE, outside React Flow state;
                   │                      node.data carries only `resultsVersion`
                   ▼
            output / display nodes read the store via useUpstreamRecords(nodeId)
```

Two things make this design work and must be preserved:

- **Records never enter node data.** Putting arrays in `node.data` re-renders the whole
  canvas on every update. The version counter is the reactivity signal.
- **Node `type` strings, data keys and handle ids are serialised** into every saved
  `.nfcs.json` workflow. They are a file format, not internal names.

The server side (`server/`) is a thin proxy layer: `server/proxies.mjs` holds the reverse
proxy table and custom middleware and is imported by *both* the Vite dev server
(`vite.config.ts`) and the Express production server (`server/index.mjs`). A URL fetch
proxy uses a Puppeteer singleton for JavaScript-rendered pages.

Where to start reading, in order: `CLAUDE.md` → `src/App.tsx` (250 lines) →
`src/utils/runWorkflow.ts` → one simple runner such as `src/utils/runDeduplicateNode.ts`
→ one search node pair (`src/nodes/ARIADNESearchNode.tsx` + `src/utils/runARIADNENode.ts`,
which use the shared `BackboneSearchNode` shell and `searchRunnerFactory`) → `src/types/UnifiedRecord.ts`.

## 2. Baseline metrics

| Metric | Before this branch | After |
|---|---|---|
| Source lines (src, TS/TSX) | ~46,800 | ~45,900 |
| Entries in `src/nodes/` (incl. `index.ts`, non-node helpers) | 62 | 59 |
| Entries in `src/utils/` (top level, incl. `gazetteers/`) | 83 | 77 |
| Vitest tests | 268 | 366 |
| `tsc -b` | clean | clean |
| `npm run lint` | could not run (no ESLint, no config) | 0 errors, 56 warnings |
| CI | none | lint · typecheck · test · build · secret scan |
| `npm audit` | 25 (1 critical, 17 high, 6 moderate, 1 low) | 12 high, all requiring major upgrades |
| Committed secrets | 1 KCL API key in 4 example files | 0 (test + CI guard) |

Lint warnings by rule: 25 `no-explicit-any`, 19 `react-hooks/exhaustive-deps`,
12 `react-refresh/only-export-components`. These are the tracked lint backlog.

## 3. Findings

Severity reflects what a user or operator gets if the issue ships, not how hard it was to find.

### 3.1 Security

| # | Finding | Status |
|---|---|---|
| S1 | **A live KCL API key was committed and pushed** in four `public/examples/*.json` workflows. Root cause: the save path (`TRANSIENT_FIELDS` in `workflowIO.ts`) did not strip `apiKey`, so every save/export/example carried the credential of whoever authored it. A Param node wired into an `apiKey` handle carried the key in `data.value` by the same route. | Fixed (commits 2 and 16): `apiKey` stripped, Param values wired to `apiKey` blanked, example files scanned for any `sk-…` string on every test run and in CI. **The key must be revoked at KCL — git history still contains it.** |
| S2 | **`/url-proxy` was an open relay.** It accepted any `http(s)` URL, followed redirects, had no size cap and no private-address block; inside Docker it could reach `ollama:11434` and cloud metadata addresses. | Fixed (commits 5 and 16): allowlist (`URL_PROXY_ALLOWLIST`), private/loopback/link-local/metadata/CGNAT addresses always denied in every encoding `new URL()` produces (dotted and hex-mapped IPv6, NAT64), DNS check on the initial target and on every redirect hop in both the fetch and Puppeteer paths, 10 MB cap, `wait` validated. Deny-all in production unless configured. The DNS check is best-effort (resolve-then-fetch; it is not a socket pin), which is why the allowlist is the primary control in production. |
| S3 | **Unauthenticated write endpoint in production.** `POST /dev/write-example` wrote into a host-mounted volume "protected by obscurity". | Fixed (commit 6): off unless `ENABLE_EXAMPLE_AUTHORING=true`. |
| S4 | `POST /api/save-workflow` has no auth or rate limit and stores a spoofable `x-forwarded-for`. | Open — workshop feature; needs a product decision (backlog B9). |
| S5 | `VITE_KCL_API_KEY` / `VITE_EUROPEANA_API_KEY` are baked into the client bundle at build time, so a deployed instance hands its key to every browser. | Open — needs a server-side credential model (backlog B9). |
| S6 | Container ran as root. | Fixed (commits 14, 17): the entrypoint starts as root only to `chown` the writable mounts (named volumes from an earlier image are root-owned) and then drops to `node` with `setpriv`. |

### 3.2 Correctness (confirmed, each pinned by a test)

| # | Finding | Status |
|---|---|---|
| C1 | **HTMLSection: Run ≠ Run All.** The component implemented `@readability` and heading-section modes; the runner only did `querySelectorAll`. | Fixed (commit 7): one `extractHtml()` in `src/utils/htmlExtract.ts`, used by both. |
| C2 | **Stale results after validation failure.** KCL, Ollama and Europeana runners returned on "no key / no model / no query" *before* clearing the store, so downstream nodes kept reading the previous run. | Fixed (commit 8). |
| C3 | **Runners that could throw.** Geocoding (left the node stuck in `loading` with an open `console.group`), Deduplicate, Comment; ImageView never set a status. | Fixed (commit 8). |
| C4 | **Results store leaked.** Nothing evicted records when a node was deleted or a workflow loaded. | Fixed (commit 8): `onNodesDelete` + `clearAllResults` on load. |
| C5 | `'running'` status had no theme colour (`STATUS_BORDER` only knew `'loading'`); ten nodes carried private maps to compensate. | Fixed (commit 9): alias. |
| C6 | `ExpandedOutputPanel` called `useMemo` after an early `return null` (conditional hook). | Fixed (commit 3, surfaced by the new lint). |
| C7 | A saved workflow referencing a node type the build no longer registers rendered as a blank default box. | Fixed (commit 11): dropped with a warning in the top bar. |

### 3.3 Maintainability — what was fixed

- `npm run lint` could not run; 50 `eslint-disable` comments were inert. ESLint 9 flat
  config added; tiers chosen so the baseline passes (commit 3).
- No CI. GitHub Actions workflow added (commit 4).
- Two deprecated, Cloudflare-blocked nodes (`adsSearchAdvanced`, `adsLibrarySearch`) were
  still wired into ~25 files plus two Puppeteer middlewares. Removed (commit 12, −1,645 lines).
- Dead `withDuplicate.tsx` removed (commit 10).
- Root-level clutter archived under `docs/`; local tooling files untracked (commit 1).
- Docker build skipped the typecheck. Fixed (commit 14).

### 3.4 Maintainability — what remains (the structural backlog)

These are the findings that make the node layer hard to extend. They are *not* fixed on
this branch; §6 orders them.

**Duplication across node components** (59 files)

- 40 files hard-code their own `HEADER_COLOR`; only 8 import `src/styles/theme.ts`, which
  already holds `NODE_IDENTITY`. 21 files define a private `STATUS_BORDER` map. 45 files
  carry a private `styles` object; `card:` is defined 45 times; 516 inline `style={{…}}`
  across 50 files.
- The header/status-badge/handle/run-button block is hand-rolled in ~44 files. `handleTop()`
  is defined 6 times. The `apiKey` handle is copied character-for-character in 3 files.
- The KCL chat client is written 8 times (`utils/arc.ts` exists and is used by 2 callers);
  `KCL_CHAT` is defined in 10 files, `KCL_MODELS` in 7.
- 14 inline field-discovery helpers with *different* semantics: KCLField, OllamaField and
  Evaluator scan only `records[0]` and drop nested `gbif.*` fields; QuickNote,
  ComparisonReport and QuickView scan 20 records and keep them.
- `NAMESPACE_KEYS` exists 3 times and has drifted: `exportUtils` ignores seven namespaces
  that `smartGeoExtractor` knows about. `LABEL_BY_TYPE` ×3. `RUNTIME_FIELDS` (withToolbar)
  ≈ `TRANSIENT_FIELDS` (workflowIO).

**Work done twice** (component path vs runner path)

- Seven nodes run their work in the component *and* in a runner with copied helpers: KCL,
  KCLField, Ollama, OllamaField, Evaluator, URLFetch, HTMLSection (the last is now shared).
  When they diverge, Run and Run All disagree — C1 was one instance.
- Five nodes transform records with **no runner at all** (SmartFilter, SourceProfile,
  FieldDistribution, QuickNote pass-through, TableOutput pass-through), so Run All cannot
  recompute them.
- Seven components read `getNodes().find(n => n.id === id)` during render instead of using
  the `data` prop.

**Type and module boundaries**

- `AppNode` is a 50-member union with no discriminant; 47 of its data interfaces live in
  component files, so `types/` depends on `nodes/` and 23 `utils/` files import from
  `nodes/*.tsx` (utilities depend on React components).
- `NodeRunner` is declared in `nodeRunners.ts`, which imports every runner — a type-only
  cycle with 21 files.
- `src/utils/` is a flat bag of 77 files; 14 have exactly one importer.
- Status vocabulary is unstandardised (`loading` ×20, `running` ×17, plus `ok`, `ready`,
  `scanning`); 14 separately declared `*Status` unions.

**Size**

- 14 node files exceed 700 lines. `ImageViewNode` (1,149) contains an IIIF client, a
  hand-written EXIF parser, a region annotator and the UI. `QuickNoteNode` (1,001) has three
  modes in one render. `TableOutputNode` (957) mixes grid, column discovery (duplicated in
  `ExpandedOutputPanel`), reconciliation overrides and pass-through.
- `public/fixtures` is 42 MB and is copied wholesale into `dist/`.

**Tests**

- No tests for components, hooks, the server, 7 search adapters, or ~27 of the 31 runners.

### 3.5 Documentation drift (fixed on this branch)

README said Node 18 (vitest 4 needs 20), referenced a `deploy/express-server` branch that
no longer exists, and used pre-TaDiRAH section names. `CLAUDE.md` said "frontend only" and
"GBIF: direct", listed the ADS routes, omitted `/gbif-proxy` and `/bnb-proxy`, and carried
pre-theme header colours. The `new-node` skill used old group names; the `sync-deploy` skill
described syncing to the dead branch and was removed.

## 4. What this branch changed, by commit

| # | Commit | Area |
|---|---|---|
| 1 | `chore(repo)` | untrack local settings, ignore scratch, archive stray docs, `.editorconfig` |
| 2 | `fix(security)` | strip committed key, `apiKey` never persisted, re-injected on load, gitleaks config, tests |
| 3 | `chore(lint)` | ESLint 9 flat config, conditional-hook fix, `npm run typecheck` |
| 4 | `ci` | GitHub Actions: lint, typecheck, test, build, secret scan |
| 5 | `fix(server)` | `/url-proxy` allowlist, private-IP block, DNS check, redirect re-check, size cap |
| 6 | `fix(server)` | `/dev/write-example` gated by `ENABLE_EXAMPLE_AUTHORING` |
| 7 | `fix(htmlSection)` | shared `htmlExtract.ts` for Run and Run All |
| 8 | `fix(runners)` | never-throw wrappers, clear-before-fail, ImageView status, store eviction |
| 9 | `fix(theme)` | `running` status alias |
| 10 | `chore` | delete dead `withDuplicate.tsx` |
| 11 | `feat(workflowIO)` | unknown node types dropped on load with a warning |
| 12 | `refactor` | remove ADS nodes, runners, adapters, middlewares, proxy route |
| 13 | `chore(deps)` | `npm audit fix` (non-breaking): 25 → 12 vulnerabilities, 0 critical |
| 14 | `chore(docker)` | typecheck in image build, non-root user |
| 15 | `docs` | this review, `CONTRIBUTING.md`, `CLAUDE.md`/README corrections |
| 16 | `fix` | post-review fix pass: mapped-IPv6/NAT64/CGNAT encodings, Puppeteer redirect DNS check + 403, Param-wired keys blanked on save, KCL stale-closure deps, HTMLSection empty-selector parity |
| 17 | `fix` | second review pass: Puppeteer subresources (XHR/fetch/scripts/sub-frames) can no longer reach private hosts and third-party iframes no longer poison the response; credential Params behind collapsed groups are blanked on save and re-filled on load; dropped-node pruning sees through collapsed groups; DNS guard checks every answer; redirect bodies released and one deadline per chain; Docker entrypoint fixes volume ownership before dropping to `node` |

## 5. Deliberately deferred, with rationale

| Item | Why not now |
|---|---|
| Rewriting git history to purge the key | User decision: rotate the key instead; a force-push would break every clone. |
| Server-side credential model (S5) | Changes how every KCL node is configured and how Docker is deployed; needs design. |
| Node-layer consolidation (§3.4) | Touches most of the 59 node files; the funded team should own the pattern. Guardrails had to land first so that work is safe. |
| Major dependency upgrades (vite 8, vitest 5, TS 7, express 5, puppeteer 25, pdfjs-dist 6, http-proxy-middleware 4) | Each is a breaking change; the remaining 12 `npm audit` findings all sit behind these. Do them one at a time on CI. |
| Type-aware ESLint rules | Expensive on 59 node files; add once the component count is under control. |
| Server tests | `server/index.mjs` calls `app.listen` at import; needs an app-factory refactor first. |
| `/dev/write-example` duplication between `vite.config.ts` and `server/index.mjs` | Cosmetic once gated. |

## 6. Recommended backlog, in order

Each item is a branch of its own with the four gates green at every commit.

- **B1 — Shared `NodeShell`.** One component for card / header / status badge / handles /
  run button / `NodeResizer` styling, driven by `theme.ts` (`NODE_IDENTITY`, `STATUS_BORDER`).
  Migrate the 40 hard-coded `HEADER_COLOR` files to it. This is the largest single win for
  "add a node without copying 200 lines".
- **B2 — One KCL client.** Route the 8 hand-written chat clients through `utils/arc.ts`;
  one `KCL_CHAT` / `KCL_MODELS` definition in `kclConfig.ts`.
- **B3 — Types out of components.** Move every `*NodeData` interface and `NodeRunner` into
  `src/types/`, give `AppNode` a `type` discriminant, and type the registries as
  `Record<NodeTypeId, …>` rather than `Record<string, …>`. Removes the utils→nodes dependency.
- **B4 — One run path per node.** Give the five component-only transforms runners; make the
  seven dual-path nodes call their runner from the component (keeping streaming/partial
  updates as runner options). Then Run and Run All cannot disagree.
- **B5 — Standardise status and field discovery.** One `NodeStatus` union
  (`idle | running | success | error | cached`) and one `discoverFields(records)` utility
  with the "scan N records, keep nested namespaces" semantics.
- **B6 — Split the three largest nodes.** ImageView → IIIF client + EXIF parser + annotator
  modules; QuickNote → one module per mode; TableOutput → grid vs. container.
- **B7 — Feature folders.** Move single-importer utilities next to their node
  (`src/nodes/geocoding/…`), keep `src/utils/` for genuinely shared code.
- **B8 — Tests for adapters and runners.** Fixture-driven tests for the 7 untested search
  adapters; contract tests for every runner (extend `runnerContract.test.ts`).
- **B9 — Credential model.** Keys held server-side (or per-session), never in the bundle or
  node data; auth for `/api/save-workflow`.
- **B10 — Dependency majors**, one per PR, in this order: vitest 5, vite 8 / plugin-react 6,
  TypeScript 7, pdfjs-dist 6, puppeteer 25, http-proxy-middleware 4, express 5.
- **B11 — Fixture size.** Git LFS or move the LLDS collection files out of `public/`.
- **B12 — Node 22.** CI and the Docker image run Node 20; `pdfjs-dist@5.7` declares
  `engines.node >=22.13` (a warning only — it is bundled for the browser). Move both to
  Node 22 LTS at the next convenient point.

## 7. Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `VITE_KCL_API_KEY` | build time (Dockerfile `--build-arg`, `.env`) | Default KCL key baked into the bundle. See S5. |
| `VITE_EUROPEANA_API_KEY` | build time | Default Europeana key. |
| `OLLAMA_HOST` | server | Upstream for `/ollama/*` (default `http://localhost:11434`). |
| `URL_PROXY_ALLOWLIST` | server | Comma-separated host suffixes `/url-proxy` may fetch. Unset = any public host in development, deny-all in production. |
| `ENABLE_EXAMPLE_AUTHORING` | server | `true` exposes `POST /dev/write-example` in production. Default off. |
| `NODE_ENV` | server | Set to `production` by the Dockerfile; selects the proxy's deny-all default. |
| `PUPPETEER_EXECUTABLE_PATH` / `PUPPETEER_SKIP_DOWNLOAD` | Docker / CI | Use system Chromium; skip the download in CI. |

## 8. Verification performed on this branch

- `npm run lint` → 0 errors, 56 warnings; `npm run typecheck` → clean; `npx vitest run` →
  366/366; `npx vite build` → ok. All run after every commit.
- Residue scans: no `sk-` keys in `public/` or `src/`; no reference to the removed ADS
  types in `src/`, `server/` or `vite.config.ts`.
- `npm audit` before/after as in §2.
- Docker: `docker build` succeeds with `tsc -b` running in the builder stage. Smoke test of
  the image: process runs as `node`, `NODE_ENV=production`; `/url-proxy` answers 403 for both
  a public host (no allowlist configured) and `169.254.169.254`; `POST /dev/write-example`
  is 404 (gated); `/` serves the app. Docker's build linter warns that `VITE_*` keys are
  passed as `ARG`/`ENV` — that is finding S5, unchanged on this branch.
- Two independent reviews of the whole branch were run (after commits 15 and 16); every
  Important finding was fixed (commits 16 and 17), each with a test that failed first where
  a test harness exists. Remaining minors are listed in the PR description.
- **Not verified here:** the GitHub Actions run — the first push exercises it; treat that
  first CI run as the check.
