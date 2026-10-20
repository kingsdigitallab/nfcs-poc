# NHMSearch Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. At execution start, copy this file to `docs/superpowers/plans/2026-10-20-nhm-search-node.md` so the plan travels with the branch.

**Goal:** Add an `nhmSearch` data-source node that queries the Natural History Museum Data Portal (`datastore_search`), maps results to `UnifiedRecord` under `nhm.*`, ships two committed fixtures, and is registered in every facet (sidebar, defaults, theme, lineage, QuickStart, source profile, docs).

**Architecture:** Bespoke runner (`runNHMNode.ts`, GBIF-shaped limit/offset paging over `runnerHelpers.ts`) + pure adapter (`nhmAdapter.ts`) + a thin `BackboneSearchConfig` component (same shell ARIADNE/HSDS/Bodleian/SMG/VA use, so the frozen `query`/`limit` handle contract comes for free). Direct browser fetch; no proxy row.

**Tech Stack:** React 19 + TypeScript + Vite, `@xyflow/react`, vitest (jsdom). Gates: `npm run lint`, `npm run typecheck`, `npx vitest run`, `npx vite build`.

**Spec:** `docs/handoff-nhm-search-node.md` (read it first; this plan argues from it). Supporting: `CLAUDE.md` (Registration Checklist, Results Store, NodeRunner Contract), `.claude/skills/new-node/SKILL.md`, `docs/federation-baseline.md`.

## Context

The GBIF node already reaches most NHM specimens via the aggregator, but GBIF holds none of the 377k mineralogy/petrology records, flattens locality text and drops per-image rights. An NHM node sitting beside the GBIF node demonstrates aggregator-route vs home-institution-route, joinable on `nhm.gbifID` ↔ `gbif.key`. The handoff was written from live browser tests on 2026-10-20; it fixes the API facts and field mapping. This plan turns it into tasks that fit the repo's existing shell, runner-helper and fixture conventions.

## Decisions taken while planning (deviations from the handoff, all deliberate)

1. **Component uses the `BackboneSearchNode` shell**, not a GBIF-style bespoke layout. The handoff says "follow GBIFSearchNode for layout and ARIADNESearchNode for the Filters panel"; ARIADNESearchNode *is* a 20-line config over the shell, and the shell already provides query/limit wirable rows, fetch-all, an extra body row (used for the resource dropdown), single-select sort and a declarative filter panel. Only Europeana/GBIF stay off the shell, for handle-layout reasons that don't apply here. `backboneHandles.test.ts` must gain an NHM block (CLAUDE.md requirement for every migrated config).
2. **Fetch-all cap = 2,000 records (20 pages).** The handoff cites ARIADNE's cap as precedent, but `makeSearchRunner` has no cap (`fetchAll ? Infinity : limit`); Bodleian caps at 500 and GBIF at 40 pages. 2,000 keeps a worst-case ALL run at ~20 requests / ~5 s at the 250 ms pacing. Capped runs use the MDS/GBIF amber convention (`⚠ capped …`, `_capped`, `_total`, `cappedAmberStatus: true`).
3. **No separate `limit: 1` probe.** The first page doubles as the probe (CKAN returns `total` with every page), saving one request per run against the 5 req/s politeness budget. `Page N/M (X fetched)…` is shown from page 2 onwards.
4. **POST with a JSON body** (the form the handoff verified cross-origin). GET would avoid a preflight but `filters` would need JSON-in-a-query-param, which the handoff did not test.
5. **ImageView IIIF mode is NOT extended in this plan.** Exploration confirmed IIIF mode only accepts a Presentation manifest (`extractManifestEntries` reads `bodleian|smg|vam|iiif .manifest`; `fetchImageInfo` never reads `info.id`). Adding an image-service path is more than a small change, so per the handoff's own fallback the first cut writes `nhm.thumbnail` (Images mode picks it up via the `/thumb|…|media/i` key scan) and `nhm.iiifInfo` for the follow-up. Record this as a follow-up in the docs task.
6. **User-agent limitation goes in the source profile only.** `RecordCitation` has no free-text field; the citation `licence` string carries the licence facts instead.
7. **Colour `#5e6b2b` (olive)**: distinct from GBIF's blue-teal `#2c5a74` and from every other Discovering hue (all blues/purples/umber).

## Global Constraints

- Node type key `nhmSearch`, id prefix `nhm`, namespace `nhm.*`, `_source: 'nhm'`, record id `nhm:${occurrenceID}` (fallback `nhm:${_id}`), never `Math.random()`.
- API base `https://data.nhm.ac.uk/api/3/action/datastore_search`; specimen resource `05ff2255-c38a-40c9-b657-4ccb55ab2feb`; index lots `bb909597-dedf-427d-8c04-4c02b3a24db3`.
- Page size 100; ≥ 250 ms between pages (stay well under 5 req/s); fetch-all cap 2,000.
- `filters` key omitted entirely when no filter is set; one value per field; `sort` omitted for relevance.
- Runner never throws; terminal status `success | error`; `clearNodeResults` first; records only via `setNodeResults` (`finishRunnerSuccess`).
- No `server/proxies.mjs` change. `robots.txt` disallows `/api/`; do not add a proxy.
- Handle contract: `query` top 51, `limit` top 78, output `results` (shell-provided; pinned by `backboneHandles.test.ts`).
- Fixtures: `public/fixtures/nhmSearch-stonehenge.json` (142 records) and `nhmSearch-wordsworth.json`, captured from the app, never hand-edited.
- All four gates green before every commit. Branch `feat/nhm-search-node`, one conventional commit per task.

## Review Focus

Inputs the spec implies but no acceptance step exercises; each has a pinned test in the owning task.

1. `associatedMedia` arrives as a JSON **string** (CKAN sometimes serialises nested values) rather than an array → adapter must parse it, never crash, and still set `nhm.thumbnail`. (Task 1)
2. CKAN returns HTTP 200 with `success: false` and an `error` whose `message` is missing or an object (validation errors are `{__type, field: [..]}`) → runner reports a readable error string, never `[object Object]` or an exception. (Task 3)
3. Coordinates `""` or absent → `null`; `"0"` → `0` (not null); non-numeric → `null`. MapOutput depends on this. (Task 1)
4. Empty `occurrenceID` → id from `_id`, `_pid` and `_sourceUrl` **undefined** (not `""`), so the Citation node doesn't print a dangling link. (Task 1)
5. Limit smaller than a page (20) → exactly one request with `limit: 20`; total 142 at page size 100 → exactly two requests and no third; limit 50 with total 142 → one request of 50. (Task 3)

---

### Task 1: Adapter + `nhm` namespace

**Files:**
- Create: `src/utils/nhmAdapter.ts`
- Modify: `src/types/UnifiedRecord.ts` (add `nhm?:` namespace after `bodleian?` at ~line 178)
- Test: `src/__tests__/nhmAdapter.test.ts`

**Interfaces:**
- Produces: `adaptNHMResult(result: NHMDatastoreResult): UnifiedRecord[]`, `composeNHMDate(year?, month?, day?): string | undefined`, `nhmTitle(rec: NHMRecord): string`, `nhmMediaList(rec: NHMRecord): NHMMedia[]`, types `NHMRecord`, `NHMMedia`, `NHMDatastoreResult`, `NHMDatastoreResponse`, const `NHM_MEDIA_BASE`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/nhmAdapter.test.ts
import { describe, it, expect } from 'vitest'
import {
  adaptNHMResult, composeNHMDate, nhmTitle, nhmMediaList,
  type NHMRecord, type NHMDatastoreResult,
} from '../utils/nhmAdapter'

const wrap = (records: NHMRecord[]): NHMDatastoreResult => ({ total: records.length, records })

const BOT: NHMRecord = {
  _id: 1001, occurrenceID: 'aaaa-1111', institutionCode: 'NHMUK', collectionCode: 'BOT',
  basisOfRecord: 'PreservedSpecimen', scientificName: 'Plantago lanceolata L.',
  catalogNumber: 'BM001234', locality: 'Stonehenge, Wiltshire', habitat: 'Chalk downland',
  country: 'United Kingdom', decimalLatitude: '51.1789', decimalLongitude: '-1.8262',
  recordedBy: ['J. Smith', 'A. Jones'], year: '1882', month: '6', day: '18',
  subDepartment: 'Botany', family: 'Plantaginaceae', gbifID: '123456789',
  associatedMedia: [{ identifier: 'https://data.nhm.ac.uk/media/abc-123', license: 'http://creativecommons.org/licenses/by/4.0/', rightsHolder: 'The Trustees of the Natural History Museum, London' }],
  associatedMediaCount: '1',
}
const MIN: NHMRecord = {
  _id: 2002, occurrenceID: 'bbbb-2222', collectionCode: 'MIN', basisOfRecord: 'Occurrence',
  scientificName: 'Sarsen stone', subDepartment: 'Petrology', catalogNumber: 'BM.1920,123',
  locality: 'Stonehenge', year: '1920',
}
const MIN_NO_NAME: NHMRecord = {
  _id: 3003, occurrenceID: 'cccc-3333', collectionCode: 'MIN', basisOfRecord: 'Occurrence',
  scientificName: '', subDepartment: 'Petrology', catalogNumber: 'BM.1920,124',
}

describe('composeNHMDate', () => {
  it('composes year / year-month / year-month-day with zero padding', () => {
    expect(composeNHMDate('1882')).toBe('1882')
    expect(composeNHMDate('1882', '6')).toBe('1882-06')
    expect(composeNHMDate('1882', '6', '18')).toBe('1882-06-18')
    expect(composeNHMDate('1882', '11', '3')).toBe('1882-11-03')
  })
  it('returns undefined without a year, and stops at the first missing part', () => {
    expect(composeNHMDate(undefined, '6', '18')).toBeUndefined()
    expect(composeNHMDate('', '6')).toBeUndefined()
    expect(composeNHMDate('1882', '', '18')).toBe('1882')
    expect(composeNHMDate('1882', 'June')).toBe('1882')
  })
})

describe('nhmTitle fallback chain', () => {
  it('prefers scientificName (BOT and MIN rock names alike)', () => {
    expect(nhmTitle(BOT)).toBe('Plantago lanceolata L.')
    expect(nhmTitle(MIN)).toBe('Sarsen stone')
  })
  it('falls back to determinationFiledAs, then catalogNumber, then the _id', () => {
    expect(nhmTitle({ ...MIN_NO_NAME, determinationFiledAs: 'Dolerite' })).toBe('Dolerite')
    expect(nhmTitle({ ...MIN_NO_NAME, determinationFiledAs: ['Dolerite', 'Spotted'] })).toBe('Dolerite')
    expect(nhmTitle(MIN_NO_NAME)).toBe('BM.1920,124')
    expect(nhmTitle({ _id: 7 })).toBe('NHM specimen 7')
  })
})

describe('nhmMediaList', () => {
  it('returns the array as-is, parses a JSON string, and tolerates garbage', () => {
    expect(nhmMediaList(BOT)).toHaveLength(1)
    const asString = { ...BOT, associatedMedia: JSON.stringify(BOT.associatedMedia) }
    expect(nhmMediaList(asString)[0].identifier).toBe('https://data.nhm.ac.uk/media/abc-123')
    expect(nhmMediaList({ ...BOT, associatedMedia: 'not json' })).toEqual([])
    expect(nhmMediaList({ ...BOT, associatedMedia: undefined })).toEqual([])
  })
})

describe('adaptNHMResult', () => {
  it('maps provenance: id, _source, _sourceId, _sourceUrl, _pid', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    expect(rec.id).toBe('nhm:aaaa-1111')
    expect(rec._source).toBe('nhm')
    expect(rec._sourceId).toBe('aaaa-1111')
    expect(rec._sourceUrl).toBe('https://data.nhm.ac.uk/object/aaaa-1111')
    expect(rec._pid).toBe('aaaa-1111')
  })
  it('falls back to _id when occurrenceID is empty and leaves _pid/_sourceUrl undefined', () => {
    const [rec] = adaptNHMResult(wrap([{ ...BOT, occurrenceID: '' }]))
    expect(rec.id).toBe('nhm:1001')
    expect(rec._pid).toBeUndefined()
    expect(rec._sourceUrl).toBeUndefined()
    expect(rec._sourceId).toBeUndefined()
  })
  it('maps cross-service fields', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    expect(rec.title).toBe('Plantago lanceolata L.')
    expect(rec.description).toBe('Stonehenge, Wiltshire; Chalk downland')
    expect(rec.creator).toEqual(['J. Smith', 'A. Jones'])
    expect(rec.date).toBe('1882-06-18')
    expect(rec.subject).toEqual(['BOT', 'Botany', 'Plantaginaceae'])
    expect(rec.country).toBe('United Kingdom')
  })
  it('parses coordinates: strings → numbers, "" → null, "0" → 0, junk → null', () => {
    const [a, b, c, d] = adaptNHMResult(wrap([
      BOT,
      { ...BOT, decimalLatitude: '', decimalLongitude: undefined },
      { ...BOT, decimalLatitude: '0', decimalLongitude: '0' },
      { ...BOT, decimalLatitude: 'n/a', decimalLongitude: 'x' },
    ]))
    expect(a.decimalLatitude).toBeCloseTo(51.1789)
    expect(a.decimalLongitude).toBeCloseTo(-1.8262)
    expect(b.decimalLatitude).toBeNull(); expect(b.decimalLongitude).toBeNull()
    expect(c.decimalLatitude).toBe(0);    expect(c.decimalLongitude).toBe(0)
    expect(d.decimalLatitude).toBeNull(); expect(d.decimalLongitude).toBeNull()
  })
  it('stores the raw record wholesale under nhm.* and writes NO flat domain fields', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    const ns = rec.nhm as Record<string, unknown>
    expect(ns.scientificName).toBe('Plantago lanceolata L.')
    expect(ns.gbifID).toBe('123456789')
    expect(ns.family).toBe('Plantaginaceae')
    for (const flat of ['scientificName', 'family', 'gbifID', 'catalogNumber', 'basisOfRecord', 'collectionCode', 'locality', 'year'])
      expect(flat in rec, `flat ${flat} should not exist`).toBe(false)
  })
  it('derives nhm.thumbnail and nhm.iiifInfo from the first media item, absent when no media', () => {
    const [withMedia, without] = adaptNHMResult(wrap([BOT, MIN]))
    const ns = withMedia.nhm as Record<string, unknown>
    expect(ns.thumbnail).toBe('https://data.nhm.ac.uk/media/abc-123/thumbnail')
    expect(ns.iiifInfo).toBe('https://data.nhm.ac.uk/media/abc-123/info.json')
    const ns2 = without.nhm as Record<string, unknown>
    expect('thumbnail' in ns2).toBe(false)
    expect('iiifInfo' in ns2).toBe(false)
  })
  it('handles the mineralogy shapes: rock-name title, catalogue fallback, no gbifID, no coords', () => {
    const [min, noName] = adaptNHMResult(wrap([MIN, MIN_NO_NAME]))
    expect(min.title).toBe('Sarsen stone')
    expect(min.date).toBe('1920')
    expect(noName.title).toBe('BM.1920,124')
    expect((min.nhm as Record<string, unknown>).gbifID).toBeUndefined()
    expect(min.decimalLatitude).toBeNull()
    expect(min.description).toBe('Stonehenge')
    expect(noName.description).toBeUndefined()
  })
  it('never leaves title empty', () => {
    for (const r of adaptNHMResult(wrap([{}, { _id: 9 }, { catalogNumber: 'X' }])))
      expect((r.title as string).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/nhmAdapter.test.ts`
Expected: FAIL — cannot resolve `../utils/nhmAdapter`.

- [ ] **Step 3: Add the namespace to `UnifiedRecord`**

In `src/types/UnifiedRecord.ts`, after the `bodleian?:` line (~178) add:

```ts
  /** Natural History Museum Data Portal namespace (raw Darwin Core specimen record + derived thumbnail / iiifInfo) */
  nhm?: Record<string, unknown>
```

- [ ] **Step 4: Write the adapter**

```ts
// src/utils/nhmAdapter.ts
/**
 * NHM Data Portal adapter — the only place that knows the shape of a CKAN
 * `datastore_search` result from https://data.nhm.ac.uk. Maps the flat Darwin
 * Core specimen records to UnifiedRecord[].
 *
 * Namespace hygiene (docs/federation-baseline.md): the raw record is stored
 * wholesale under nhm.*; only genuinely cross-service fields are lifted to the
 * top level. Two derived keys are added to the namespace when the record has
 * media: nhm.thumbnail (JPEG) and nhm.iiifInfo (IIIF Image API 3 info.json).
 * There is no Presentation manifest, so nhm.manifest is deliberately absent.
 *
 * Payload facts (verified 2026-10-20, see docs/handoff-nhm-search-node.md):
 * all scalars are strings (coordinates, year, month, day included);
 * recordedBy is string[]; associatedMedia is an array of objects whose
 * `identifier` is https://data.nhm.ac.uk/media/{assetID}.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

export const NHM_MEDIA_BASE = 'https://data.nhm.ac.uk/media/'
export const NHM_OBJECT_BASE = 'https://data.nhm.ac.uk/object/'

export interface NHMMedia {
  identifier?: string
  title?: string
  license?: string
  rightsHolder?: string
  [k: string]: unknown
}

export interface NHMRecord {
  _id?: number | string
  occurrenceID?: string
  scientificName?: string
  determinationFiledAs?: string | string[]
  catalogNumber?: string
  locality?: string
  habitat?: string
  recordedBy?: string | string[]
  year?: string
  month?: string
  day?: string
  collectionCode?: string
  subDepartment?: string
  family?: string
  country?: string
  decimalLatitude?: string | number
  decimalLongitude?: string | number
  associatedMedia?: NHMMedia[] | string
  associatedMediaCount?: string | number
  gbifID?: string
  [k: string]: unknown
}

export interface NHMDatastoreResult {
  total: number
  records: NHMRecord[]
  fields?: { id: string; type: string }[]
  facets?: Record<string, { values: Record<string, number> }>
  after?: unknown
}

/** CKAN action envelope. On failure `success` is false and `error` is set. */
export interface NHMDatastoreResponse {
  success: boolean
  result?: NHMDatastoreResult
  error?: { message?: unknown; __type?: string; [k: string]: unknown }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Zero-padded `YYYY[-MM[-DD]]`, truncated at the first missing/non-numeric part. */
export function composeNHMDate(year?: unknown, month?: unknown, day?: unknown): string | undefined {
  const y = str(year)
  if (!/^\d{1,4}$/.test(y)) return undefined
  const m = str(month)
  if (!/^\d{1,2}$/.test(m)) return y
  const d = str(day)
  if (!/^\d{1,2}$/.test(d)) return `${y}-${m.padStart(2, '0')}`
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** scientificName → determinationFiledAs → catalogNumber → "NHM specimen {_id}". */
export function nhmTitle(rec: NHMRecord): string {
  const filedAs = Array.isArray(rec.determinationFiledAs) ? rec.determinationFiledAs[0] : rec.determinationFiledAs
  return str(rec.scientificName) || str(filedAs) || str(rec.catalogNumber) || `NHM specimen ${rec._id ?? '(unknown)'}`
}

/** associatedMedia as an array — accepts the array, a JSON-encoded string, or nothing. */
export function nhmMediaList(rec: NHMRecord): NHMMedia[] {
  const raw = rec.associatedMedia
  if (Array.isArray(raw)) return raw.filter((m): m is NHMMedia => !!m && typeof m === 'object')
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter((m): m is NHMMedia => !!m && typeof m === 'object') : []
    } catch { return [] }
  }
  return []
}

function toCoord(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = str(v)
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

export function adaptNHMResult(result: NHMDatastoreResult): UnifiedRecord[] {
  return (result.records ?? []).map(rec => {
    const occ = str(rec.occurrenceID)
    const media = nhmMediaList(rec)
    const firstMedia = str(media[0]?.identifier)
    const subject = [rec.collectionCode, rec.subDepartment, rec.family].map(str).filter(Boolean)
    const description = [rec.locality, rec.habitat].map(str).filter(Boolean).join('; ')
    const creator = Array.isArray(rec.recordedBy)
      ? (rec.recordedBy.length ? rec.recordedBy : undefined)
      : (str(rec.recordedBy) || undefined)

    return {
      id: occ ? `nhm:${occ}` : `nhm:${rec._id ?? 'unknown'}`,

      _source:    'nhm',
      _sourceId:  occ || undefined,
      _sourceUrl: occ ? `${NHM_OBJECT_BASE}${occ}` : undefined,
      _pid:       occ || undefined,   // CETAF stable identifier

      title:       nhmTitle(rec),
      description: description || undefined,
      creator,
      date:        composeNHMDate(rec.year, rec.month, rec.day),
      subject:     subject.length ? subject : undefined,
      country:     str(rec.country) || undefined,
      decimalLatitude:  toCoord(rec.decimalLatitude),
      decimalLongitude: toCoord(rec.decimalLongitude),

      nhm: {
        ...(rec as Record<string, unknown>),
        ...(firstMedia ? { thumbnail: `${firstMedia}/thumbnail`, iiifInfo: `${firstMedia}/info.json` } : {}),
      },
    } satisfies UnifiedRecord
  })
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/__tests__/nhmAdapter.test.ts && npm run typecheck`
Expected: all adapter tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git checkout -b feat/nhm-search-node
git add src/utils/nhmAdapter.ts src/types/UnifiedRecord.ts src/__tests__/nhmAdapter.test.ts
git commit -m "feat(nhm): adapter mapping NHM Data Portal records to UnifiedRecord

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Component config + core registration

Registers the type in `nodeTypes` FIRST so every `satisfies Partial<Record<NodeTypeId,…>>` registry (runners, defaults, describers) can accept `nhmSearch`.

**Files:**
- Create: `src/nodes/NHMSearchNode.tsx`
- Modify: `src/nodes/index.ts` (import + `nhmSearch: withToolbar(NHMSearchNode)` after `hsdsSearch`), `src/types/AppNode.ts` (import ~line 32, union line ~90), `src/config/nodeDefaults.ts` (import ~line 8, factory after `hsdsSearch` ~line 126), `src/config/sidebarItems.ts` (row after `mdsSearch` line 68), `src/styles/theme.ts` (`NODE_IDENTITY` after `mdsSearch` line 97)
- Test: `src/__tests__/backboneHandles.test.ts` (append NHM block)

**Interfaces:**
- Produces: `NHMSearchNodeData` (consumed by Task 3's runner), `NHM_CONFIG: BackboneSearchConfig`, `NODE_IDENTITY.nhmSearch === '#5e6b2b'`.
- Data keys (serialised into workflow files, never rename): `inlineQuery, inlineLimit, fetchAll, resource, sort, collectionCode, country, year, typeStatus, basisOfRecord, useFixture`.

- [ ] **Step 1: Write the failing handle-contract test**

Append to `src/__tests__/backboneHandles.test.ts` (add `import { NHM_CONFIG } from '../nodes/NHMSearchNode'` next to the other config imports):

```ts
describe('NHM config (new node — pins its serialised surface)', () => {
  it('writes exactly the agreed filter keys, in order', () => {
    expect(NHM_CONFIG.nodeType).toBe('nhmSearch')
    expect(serialisedFilterKeys(NHM_CONFIG)).toEqual([
      'collectionCode', 'country', 'year', 'typeStatus', 'basisOfRecord',
    ])
  })
  it('resource row, single-select relevance sort, capped fetch-all, amber cap status', () => {
    expect(NHM_CONFIG.queryDataKey ?? 'inlineQuery').toBe('inlineQuery')
    expect(NHM_CONFIG.extraBodyRow?.key).toBe('resource')
    expect(NHM_CONFIG.extraBodyRow?.options.map(o => o.value)).toEqual(['specimens', 'indexlots'])
    expect(NHM_CONFIG.sort?.singleSelect).toBe(true)
    expect(NHM_CONFIG.sort?.defaultValue).toBe('relevance')
    expect(NHM_CONFIG.sort?.options.map(o => o.value)).toEqual(['relevance', 'year asc', 'year desc'])
    expect(NHM_CONFIG.fetchAll).toEqual({ label: 'Fetch all (up to 2,000)' })
    expect(NHM_CONFIG.cappedAmberStatus).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/backboneHandles.test.ts`
Expected: FAIL — cannot resolve `../nodes/NHMSearchNode`.

- [ ] **Step 3: Write the component**

```tsx
// src/nodes/NHMSearchNode.tsx
/**
 * NHM Data Portal search node — thin config over BackboneSearchNode (the
 * shared search shell). Handle ids/positions live in the shell (query row 0,
 * limit row 1, output `results`). The `resource` body row switches between
 * the Specimen collection and the Index Lots resource; the Filters panel maps
 * 1:1 onto CKAN `filters` keys (single value each — the service rejects
 * arrays). See docs/handoff-nhm-search-node.md for the verified API facts.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type NHMStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export type NHMResource = 'specimens' | 'indexlots'

export interface NHMSearchNodeData {
  inlineQuery:    string
  inlineLimit:    string
  fetchAll:       boolean
  /** Which CKAN resource to query — maps to a resource_id in runNHMNode.ts */
  resource:       NHMResource
  /** 'relevance' omits `sort`; otherwise passed verbatim ('year asc' | 'year desc') */
  sort:           string
  // Filters panel — each is one `filters` key, single value, omitted when ''
  collectionCode: string
  country:        string
  year:           string
  typeStatus:     string
  basisOfRecord:  string
  useFixture?:    boolean
  status:         NHMStatus
  statusMessage:  string
  results:        UnifiedRecord[] | undefined
  count:          number
  [key: string]:  unknown
}

export const NHM_CONFIG: BackboneSearchConfig = {
  nodeType: 'nhmSearch',
  title:    'NHM Search',
  theme: deriveBackboneTheme(NODE_IDENTITY.nhmSearch),
  queryPlaceholder: 'e.g. Stonehenge',
  fetchAll: { label: 'Fetch all (up to 2,000)' },
  extraBodyRow: {
    key: 'resource', label: 'resource',
    options: [
      { value: 'specimens', label: 'Specimens' },
      { value: 'indexlots', label: 'Index lots' },
    ],
  },
  sort: {
    singleSelect: true,
    defaultValue: 'relevance',
    options: [
      { value: 'relevance', label: 'Relevance' },
      { value: 'year asc',  label: 'Year ↑' },
      { value: 'year desc', label: 'Year ↓' },
    ],
  },
  filters: [
    {
      key: 'collectionCode', label: 'Collection', kind: 'select',
      options: [
        { value: '',        label: '— any —' },
        { value: 'BOT',     label: 'BOT — Botany' },
        { value: 'ZOO',     label: 'ZOO — Zoology' },
        { value: 'BMNH(E)', label: 'BMNH(E) — Entomology' },
        { value: 'PAL',     label: 'PAL — Palaeontology' },
        { value: 'MIN',     label: 'MIN — Mineralogy & Petrology' },
      ],
    },
    { key: 'country',    label: 'Country',     kind: 'text', placeholder: 'e.g. United Kingdom' },
    { key: 'year',       label: 'Year',        kind: 'text', placeholder: 'exact year only, e.g. 1882' },
    { key: 'typeStatus', label: 'Type status', kind: 'text', placeholder: 'e.g. Holotype' },
    {
      key: 'basisOfRecord', label: 'Basis', kind: 'select',
      options: [
        { value: '',                  label: '— any —' },
        { value: 'PreservedSpecimen', label: 'PreservedSpecimen' },
        { value: 'FossilSpecimen',    label: 'FossilSpecimen' },
        { value: 'Occurrence',        label: 'Occurrence (minerals & rocks)' },
      ],
    },
  ],
  cappedAmberStatus: true,
}

export function NHMSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={NHM_CONFIG} />
}
```

- [ ] **Step 4: Register in `src/nodes/index.ts`**

Add `import { NHMSearchNode } from './NHMSearchNode'` after the `HSDSSearchNode` import and `nhmSearch: withToolbar(NHMSearchNode),` after the `hsdsSearch:` line in `nodeTypes`.

- [ ] **Step 5: `src/types/AppNode.ts`**

Add `import type { NHMSearchNodeData } from '../nodes/NHMSearchNode'` beside the HSDS import (~line 32) and `| Node<NHMSearchNodeData>` after `| Node<HSDSSearchNodeData>` (~line 90).

- [ ] **Step 6: `src/config/nodeDefaults.ts`**

Add `import type { NHMSearchNodeData } from '../nodes/NHMSearchNode'` after the HSDS import (line 8). After the `hsdsSearch` factory (ends ~line 126) add:

```ts
  nhmSearch: pos => ({
    id: newId('nhm'), type: 'nhmSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      resource: 'specimens', sort: 'relevance',
      collectionCode: '', country: '', year: '', typeStatus: '', basisOfRecord: '',
      useFixture: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies NHMSearchNodeData,
  }),
```

- [ ] **Step 7: `src/styles/theme.ts` + `src/config/sidebarItems.ts`**

theme.ts, after `mdsSearch: '#34406e', // indigo` (line 97):
```ts
  nhmSearch:        '#5e6b2b', // olive — natural history, distinct from GBIF blue-teal
```
sidebarItems.ts, after the `mdsSearch` row (line 68):
```ts
  { type: 'nhmSearch',         label: 'NHMSearch',             sub: 'Natural History Museum specimens (incl. mineralogy)', color: '#5e6b2b', group: 'Discovering' },
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx vitest run src/__tests__/backboneHandles.test.ts src/__tests__/theme.test.ts && npm run typecheck`
Expected: PASS; tsc clean. (`nodeRunners` has no `nhmSearch` yet — that is fine; the registry is `Partial`.)

- [ ] **Step 9: Commit**

```bash
git add src/nodes/NHMSearchNode.tsx src/nodes/index.ts src/types/AppNode.ts src/config/nodeDefaults.ts src/config/sidebarItems.ts src/styles/theme.ts src/__tests__/backboneHandles.test.ts
git commit -m "feat(nhm): NHMSearch node component on the backbone shell + core registration

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Runner

**Files:**
- Create: `src/utils/runNHMNode.ts`
- Modify: `src/utils/nodeRunners.ts` (import after `runHSDSNode`; entry `nhmSearch: withFixture('nhmSearch', runNHMNode),` after `hsdsSearch`)
- Test: `src/__tests__/runNHMNode.test.ts`

**Interfaces:**
- Consumes: `NHMSearchNodeData` (Task 2), `adaptNHMResult`/`NHMDatastoreResponse` (Task 1), `resolveParamEdge`, `resolveLimit`, `finishRunnerSuccess`, `finishRunnerError` from `runnerHelpers.ts`, `addCitation` from `citationUtils.ts`, `fetchWithTimeout` from `fetchWithTimeout.ts`, `clearNodeResults` from `store/resultsStore.ts`.
- Produces: `runNHMNode: NodeRunner`, `buildNHMFilters(d): Record<string,string> | undefined`, consts `NHM_API`, `NHM_RESOURCES`, `NHM_PAGE_SIZE = 100`, `NHM_MAX_FETCH_ALL = 2000`. Node data written on success: `status, statusMessage, count, resultsVersion, _capped, _total`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/runNHMNode.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { runNHMNode, buildNHMFilters, NHM_RESOURCES } from '../utils/runNHMNode'
import { getNodeResults, clearNodeResults } from '../store/resultsStore'
import type { NHMRecord } from '../utils/nhmAdapter'

const makeNode = (id: string, data: Record<string, unknown>): Node =>
  ({ id, type: 'nhmSearch', position: { x: 0, y: 0 }, data })

const baseData = {
  inlineQuery: 'stonehenge', inlineLimit: '20', fetchAll: false, resource: 'specimens', sort: 'relevance',
  collectionCode: '', country: '', year: '', typeStatus: '', basisOfRecord: '',
}

type Body = { resource_id: string; q?: string; filters?: Record<string, string>; sort?: string; limit: number; offset: number }

/** Fake NHM service: `total` records, each with a media item on every 3rd record. */
function mockNHM(total: number) {
  const all: NHMRecord[] = Array.from({ length: total }, (_, i) => ({
    _id: i + 1, occurrenceID: `occ-${i + 1}`, scientificName: `Taxon ${i + 1}`,
    associatedMedia: i % 3 === 0 ? [{ identifier: `https://data.nhm.ac.uk/media/m${i}` }] : [],
    associatedMediaCount: i % 3 === 0 ? '1' : '0',
  }))
  const bodies: Body[] = []
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body
    bodies.push(body)
    const records = all.slice(body.offset, body.offset + body.limit)
    return new Response(JSON.stringify({ success: true, result: { total, records } }), { status: 200 })
  })
  return { fetchMock, bodies }
}

async function run(data: Record<string, unknown>, extraNodes: Node[] = [], edges: Edge[] = []) {
  const nodes = [makeNode('n1', data), ...extraNodes]
  const updates: Record<string, unknown>[] = []
  await runNHMNode('n1', () => nodes, edges, (_, d) => updates.push(d))
  const last = updates.reduce((acc, u) => ({ ...acc, ...u }), {} as Record<string, unknown>)
  return { updates, last }
}

beforeEach(() => { clearNodeResults('n1'); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('buildNHMFilters', () => {
  it('returns undefined when nothing is set, trims values, drops blanks', () => {
    expect(buildNHMFilters(baseData)).toBeUndefined()
    expect(buildNHMFilters({ ...baseData, collectionCode: 'MIN', year: ' 1882 ', country: '   ' }))
      .toEqual({ collectionCode: 'MIN', year: '1882' })
  })
})

describe('runNHMNode', () => {
  it('limit 20 → exactly one POST with limit 20, no probe; stores adapted + cited records', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    const { last } = await run(baseData)
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ resource_id: NHM_RESOURCES.specimens, q: 'stonehenge', limit: 20, offset: 0 })
    expect(bodies[0]).not.toHaveProperty('filters')
    expect(bodies[0]).not.toHaveProperty('sort')
    const records = getNodeResults('n1') as Record<string, unknown>[]
    expect(records).toHaveLength(20)
    expect(records[0].id).toBe('nhm:occ-1')
    const c = records[0]._citation as Record<string, unknown>
    expect(c.service).toBe('Natural History Museum Data Portal')
    expect(c.url).toBe('https://data.nhm.ac.uk/object/occ-1')
    expect(c.pid).toBe('occ-1')
    expect(last).toMatchObject({ status: 'success', count: 142, _capped: false })
    expect(String(last.statusMessage)).toContain('20 of 142')
    expect(String(last.statusMessage)).toContain('7 with images')   // records 1,4,…,19 → 7
  })

  it('fetchAll with total 142 → two requests (100 + 42) and no third', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    const { updates, last } = await run({ ...baseData, fetchAll: true })
    expect(bodies.map(b => [b.limit, b.offset])).toEqual([[100, 0], [100, 100]])
    expect((getNodeResults('n1') ?? []).length).toBe(142)
    expect(last).toMatchObject({ status: 'success', count: 142, _capped: false })
    expect(updates.some(u => String(u.statusMessage).startsWith('Page 2/2'))).toBe(true)
  })

  it('limit 50 with total 142 → one request of 50', async () => {
    const { fetchMock, bodies } = mockNHM(142)
    vi.stubGlobal('fetch', fetchMock)
    await run({ ...baseData, inlineLimit: '50' })
    expect(bodies.map(b => b.limit)).toEqual([50])
    expect((getNodeResults('n1') ?? []).length).toBe(50)
  })

  it('fetchAll caps at NHM_MAX_FETCH_ALL with the amber capped convention', async () => {
    const { fetchMock, bodies } = mockNHM(2500)
    vi.stubGlobal('fetch', fetchMock)
    const { last } = await run({ ...baseData, fetchAll: true })
    expect(bodies).toHaveLength(20)
    expect((getNodeResults('n1') ?? []).length).toBe(2000)
    expect(last).toMatchObject({ status: 'success', _capped: true, _total: 2500, count: 2500 })
    expect(String(last.statusMessage)).toMatch(/⚠ capped at 2,000 of 2,500/)
  }, 20_000)

  it('passes only the set filters, the sort when not relevance, and the index-lots resource', async () => {
    const { fetchMock, bodies } = mockNHM(3)
    vi.stubGlobal('fetch', fetchMock)
    await run({ ...baseData, resource: 'indexlots', sort: 'year desc', collectionCode: 'MIN', year: '1882' })
    expect(bodies[0]).toMatchObject({
      resource_id: NHM_RESOURCES.indexlots, sort: 'year desc',
      filters: { collectionCode: 'MIN', year: '1882' },
    })
    expect(Object.keys(bodies[0].filters ?? {})).toEqual(['collectionCode', 'year'])
  })

  it('wired query and limit params override inline values; empty query omits q', async () => {
    const { fetchMock, bodies } = mockNHM(5)
    vi.stubGlobal('fetch', fetchMock)
    const params = [makeNode('p1', { value: 'wired' }), makeNode('p2', { value: '3' })]
    const edges: Edge[] = [
      { id: 'e1', source: 'p1', target: 'n1', targetHandle: 'query' },
      { id: 'e2', source: 'p2', target: 'n1', targetHandle: 'limit' },
    ]
    await run(baseData, params, edges)
    expect(bodies[0]).toMatchObject({ q: 'wired', limit: 3 })

    const { bodies: b2 } = mockNHM(5)
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
      b2.push(JSON.parse(String(init?.body)) as Body)
      return new Response(JSON.stringify({ success: true, result: { total: 0, records: [] } }), { status: 200 })
    }))
    await run({ ...baseData, inlineQuery: '   ' })
    expect(b2[0]).not.toHaveProperty('q')
  })

  it('surfaces CKAN error.message on success:false (HTTP 200) without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false, error: { message: 'Resource "x" was not found.', __type: 'Not Found Error' },
    }), { status: 200 })))
    const { last } = await run(baseData)   // resolving at all proves the runner did not throw
    expect(last.status).toBe('error')
    expect(String(last.statusMessage)).toContain('Resource "x" was not found.')
    expect(getNodeResults('n1')).toBeUndefined()
  })

  it('stringifies a non-string CKAN validation error, and reports plain HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      success: false, error: { __type: 'Validation Error', resource_id: ['Missing value'] },
    }), { status: 409 })))
    const { last } = await run(baseData)
    expect(last.status).toBe('error')
    expect(String(last.statusMessage)).toContain('Missing value')
    expect(String(last.statusMessage)).not.toContain('[object Object]')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>cloudflare</html>', { status: 503, statusText: 'Service Unavailable' })))
    const { last: l2 } = await run(baseData)
    expect(l2.status).toBe('error')
    expect(String(l2.statusMessage)).toContain('HTTP 503')
  })

  it('empty result set finishes 0 of 0', async () => {
    vi.stubGlobal('fetch', mockNHM(0).fetchMock)
    const { last } = await run(baseData)
    expect(getNodeResults('n1')).toEqual([])
    expect(last).toMatchObject({ status: 'success', count: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/runNHMNode.test.ts`
Expected: FAIL — cannot resolve `../utils/runNHMNode`.

- [ ] **Step 3: Write the runner**

```ts
// src/utils/runNHMNode.ts
/**
 * NHM Data Portal runner — CKAN `datastore_search` over the NHM
 * versioned-datastore extension. Direct browser fetch (CORS is permissive;
 * verified 2026-10-20). No proxy: robots.txt disallows /api/, and a browser
 * fetch cannot set the User-Agent the portal asks for — that limitation is
 * documented in the NHM source profile.
 *
 * Shape: limit/offset paging with `result.total` — GBIF-like, so this is a
 * bespoke runner over runnerHelpers.ts rather than a searchRunnerFactory
 * config (the factory is page/size + {total:{value},hits}; do not force-fit).
 * The first page doubles as the total probe. Pages are paced 250 ms apart to
 * stay well under the portal's 5 req/s request; "Fetch all" is capped.
 */
import type { Node, Edge } from '@xyflow/react'
import { adaptNHMResult, type NHMDatastoreResponse, type NHMDatastoreResult } from './nhmAdapter'
import type { NHMSearchNodeData } from '../nodes/NHMSearchNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { clearNodeResults } from '../store/resultsStore'
import { addCitation } from './citationUtils'
import { fetchWithTimeout } from './fetchWithTimeout'
import { resolveParamEdge, resolveLimit, finishRunnerSuccess, finishRunnerError } from './runnerHelpers'

export const NHM_API = 'https://data.nhm.ac.uk/api/3/action/datastore_search'
export const NHM_RESOURCES = {
  specimens: '05ff2255-c38a-40c9-b657-4ccb55ab2feb',
  indexlots: 'bb909597-dedf-427d-8c04-4c02b3a24db3',
} as const
export const NHM_PAGE_SIZE = 100
/** Bound a "Fetch all" run: 20 pages × 100. */
export const NHM_MAX_FETCH_ALL = 2_000
const PAGE_DELAY_MS = 250

/** Node-data keys that map 1:1 onto CKAN `filters` keys (single value each). */
const FILTER_KEYS = ['collectionCode', 'country', 'year', 'typeStatus', 'basisOfRecord'] as const

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** Non-empty, trimmed filter values — or undefined so the `filters` key is omitted entirely. */
export function buildNHMFilters(d: Record<string, unknown>): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const k of FILTER_KEYS) {
    const v = typeof d[k] === 'string' ? (d[k] as string).trim() : ''
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

interface NHMQuery {
  resource_id: string
  q?: string
  filters?: Record<string, string>
  sort?: string
}

function ckanErrorMessage(err: NHMDatastoreResponse['error'], fallback: string): string {
  if (!err) return fallback
  if (typeof err.message === 'string' && err.message) return err.message
  const { __type, ...rest } = err
  const detail = Object.keys(rest).length ? JSON.stringify(rest) : ''
  return [__type, detail].filter(Boolean).join(': ') || fallback
}

async function fetchNHMPage(body: NHMQuery & { limit: number; offset: number }): Promise<NHMDatastoreResult> {
  console.log('[NHM] POST', NHM_API, body)
  const res = await fetchWithTimeout(NHM_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let json: NHMDatastoreResponse | null = null
  try { json = await res.json() as NHMDatastoreResponse } catch { json = null }
  if (json && json.success === false) throw new Error(ckanErrorMessage(json.error, `HTTP ${res.status}`))
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  if (!json?.result) throw new Error('Malformed response from the NHM Data Portal (no result)')
  return json.result
}

function hasMedia(r: UnifiedRecord): boolean {
  const ns = r.nhm as Record<string, unknown> | undefined
  return typeof ns?.thumbnail === 'string'
}

export async function runNHMNode(
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const nodes = getNodes()
  const node  = nodes.find(n => n.id === nodeId)
  if (!node) return
  const d = node.data as NHMSearchNodeData

  clearNodeResults(nodeId)
  updateNodeData(nodeId, { status: 'loading', statusMessage: 'Loading…', count: 0 })

  try {
    const query    = (resolveParamEdge(nodeId, 'query', nodes, edges) ?? d.inlineQuery ?? '').trim()
    const limit    = resolveLimit(nodeId, nodes, edges, d.inlineLimit)
    const fetchAll = d.fetchAll ?? false
    const resource = d.resource === 'indexlots' ? 'indexlots' : 'specimens'
    const filters  = buildNHMFilters(d as Record<string, unknown>)
    const sort     = d.sort && d.sort !== 'relevance' ? d.sort : undefined

    const base: NHMQuery = {
      resource_id: NHM_RESOURCES[resource],
      ...(query   ? { q: query }   : {}),
      ...(filters ? { filters }    : {}),
      ...(sort    ? { sort }       : {}),
    }

    const citationBase = {
      service:    'Natural History Museum Data Portal',
      serviceUrl: 'https://data.nhm.ac.uk/',
      publisher:  'The Trustees of the Natural History Museum, London',
      licence:    'CC0 (specimen metadata); per-image licence and rightsHolder in nhm.associatedMedia',
      query: [
        `resource:${resource}`,
        query ? `q:${query}` : '',
        ...Object.entries(filters ?? {}).map(([k, v]) => `${k}:${v}`),
        sort ? `sort:${sort}` : '',
      ].filter(Boolean).join(', '),
      accessDate: new Date().toISOString(),
    }

    const target = fetchAll ? NHM_MAX_FETCH_ALL : limit
    const all: UnifiedRecord[] = []
    let total  = 0
    let offset = 0
    let page   = 0

    while (true) {
      const pageSize = Math.min(NHM_PAGE_SIZE, target - all.length)
      if (pageSize <= 0) break
      if (page > 0) {
        const pageCount = Math.ceil(Math.min(target, total) / NHM_PAGE_SIZE)
        updateNodeData(nodeId, { statusMessage: `Page ${page + 1}/${pageCount} (${all.length} fetched)…` })
      }
      const result = await fetchNHMPage({ ...base, limit: pageSize, offset })
      total = typeof result.total === 'number' ? result.total : 0
      const batch = adaptNHMResult(result)
      all.push(...batch)
      page++
      if (batch.length < pageSize || all.length >= Math.min(target, total)) break
      offset += pageSize
      await sleep(PAGE_DELAY_MS)
    }

    const cited = addCitation(all as Record<string, unknown>[], citationBase)
    finishRunnerSuccess(nodeId, cited, total, updateNodeData)

    const withImages = all.filter(hasMedia).length
    const imgSuffix  = withImages > 0 ? ` · ${withImages.toLocaleString()} with images` : ''
    const capped     = fetchAll && total > all.length
    updateNodeData(nodeId, capped
      ? { statusMessage: `⚠ capped at ${all.length.toLocaleString()} of ${total.toLocaleString()} (ALL limit)${imgSuffix}`, _capped: true, _total: total }
      : { statusMessage: `✓ ${all.length.toLocaleString()} of ${total.toLocaleString()}${imgSuffix}`, _capped: false, _total: total })
  } catch (err) {
    finishRunnerError(nodeId, err, updateNodeData, '[NHM]')
  }
}
```

- [ ] **Step 4: Register in `src/utils/nodeRunners.ts`**

Add `import { runNHMNode } from './runNHMNode'` after the `runHSDSNode` import and `nhmSearch: withFixture('nhmSearch', runNHMNode),` after the `hsdsSearch:` entry.

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `npx vitest run src/__tests__/runNHMNode.test.ts src/__tests__/runnerContract.test.ts && npm run typecheck && npm run lint`
Expected: PASS; tsc clean; 0 lint errors. If the 2,500-record cap test is slow (19 × 250 ms sleeps ≈ 5 s), keep its 20 s timeout; do not shorten `PAGE_DELAY_MS`.

- [ ] **Step 6: Commit**

```bash
git add src/utils/runNHMNode.ts src/utils/nodeRunners.ts src/__tests__/runNHMNode.test.ts
git commit -m "feat(nhm): datastore_search runner with offset paging, filters, cap and CKAN error surfacing

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Fixtures + conformance assertions

**Files:**
- Create: `public/fixtures/nhmSearch-stonehenge.json`, `public/fixtures/nhmSearch-wordsworth.json`
- Modify: `src/__tests__/fixtureConformance.test.ts` (`ALLOWED_TOP_LEVEL` line 36-37; new `it` block)

**Interfaces:**
- Consumes: the live app (Tasks 1–3) via its 💾 button.

- [ ] **Step 1: Add `'nhm'` to `ALLOWED_TOP_LEVEL` and write the failing NHM assertions**

In `ALLOWED_TOP_LEVEL` change the namespace line to:
```ts
  'gbif', 'llds', 'ads', 'adsLibrary', 'mds', 'europeana', 'ariadne',
  'hsds', 'bodleian', 'smg', 'vam', 'sparql', 'nhm',
```
Append inside the main `describe` (after the post-normalisation test, before its closing `})`):
```ts
  it('nhmSearch fixtures: nhm: ids, _source, _pid, numeric-or-null coords, raw payload under nhm', () => {
    const nhmFiles = files.filter(f => f.startsWith('nhmSearch-'))
    expect(nhmFiles, 'expected committed nhmSearch-*.json fixtures').toContain('nhmSearch-stonehenge.json')
    const violations: string[] = []
    for (const file of nhmFiles) {
      for (const [i, rec] of (loadRecords(file) ?? []).entries()) {
        if (!String(rec.id).startsWith('nhm:'))        violations.push(`${file}[${i}] id ${String(rec.id)}`)
        if (rec._source !== 'nhm')                     violations.push(`${file}[${i}] _source ${String(rec._source)}`)
        if (typeof rec._pid !== 'string' || !rec._pid) violations.push(`${file}[${i}] _pid missing`)
        if (!rec.nhm || typeof rec.nhm !== 'object')   violations.push(`${file}[${i}] nhm namespace missing`)
        if (typeof (rec.nhm as AnyRecord | undefined)?.occurrenceID !== 'string')
          violations.push(`${file}[${i}] nhm.occurrenceID missing`)
        for (const k of ['decimalLatitude', 'decimalLongitude'])
          if (k in rec && rec[k] !== null && typeof rec[k] !== 'number') violations.push(`${file}[${i}] ${k} not number|null`)
        for (const flat of ['scientificName', 'catalogNumber', 'collectionCode', 'gbifID'])
          if (flat in rec) violations.push(`${file}[${i}] flat ${flat} leaked to top level`)
      }
    }
    expect(violations).toEqual([])
  })

  it('nhmSearch-stonehenge.json is the mixed-collection set the handoff describes', () => {
    const recs = loadRecords('nhmSearch-stonehenge.json') ?? []
    expect(recs.length).toBeGreaterThanOrEqual(100)   // 142 at capture time; allow growth/shrink
    const codes = new Set(recs.map(r => (r.nhm as AnyRecord).collectionCode))
    expect(codes.has('MIN')).toBe(true)
    expect(codes.has('BOT')).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/fixtureConformance.test.ts`
Expected: FAIL — `nhmSearch-stonehenge.json` not in the fixture list.

- [ ] **Step 3: Capture the fixtures from the running app (primary path)**

1. `npm run dev` (port 5174), open `http://localhost:5174` in Chrome.
2. Drag **NHMSearch** from Discovering onto the canvas. Query `Stonehenge`, limit `200`, tick **Fetch all**, **▶ Run**. Expect status `✓ 142 of 142 · N with images` (total may drift slightly over time).
3. Click **💾** → browser downloads `nhmSearch-stonehenge.json`. Move it to `public/fixtures/`.
4. Change the query to `Wordsworth`, Run, 💾, move `nhmSearch-wordsworth.json` likewise.
5. Do not open or hand-edit the files.

**Fallback (only if the browser route is unavailable):** the 💾 output is exactly `addCitation(adaptNHMResult(page…), citationBase)` as stored by the runner, so a script that drives the same runner reproduces it byte-for-byte modulo `accessDate`. Write this to the scratchpad and run it with vitest's bundled `vite-node` (`npx vite-node <absolute path> stonehenge`); it imports the real runner so no mapping logic is duplicated:

```ts
// <scratchpad>/capture-nhm-fixture.ts — run: npx vite-node <this file> <query>
import { writeFileSync } from 'node:fs'
import { runNHMNode } from 'C:/Users/neil_/Repos/nfcs-poc/src/utils/runNHMNode'
import { getNodeResults } from 'C:/Users/neil_/Repos/nfcs-poc/src/store/resultsStore'
import { fixtureFilename } from 'C:/Users/neil_/Repos/nfcs-poc/src/utils/fixtureUtils'

const query = process.argv[2] ?? 'stonehenge'
const node = { id: 'cap', type: 'nhmSearch', position: { x: 0, y: 0 }, data: {
  inlineQuery: query, inlineLimit: '200', fetchAll: true, resource: 'specimens', sort: 'relevance',
  collectionCode: '', country: '', year: '', typeStatus: '', basisOfRecord: '',
} }
await runNHMNode('cap', () => [node], [], (_, d) => { if (d.statusMessage) console.error(d.statusMessage) })
const out = `C:/Users/neil_/Repos/nfcs-poc/public/fixtures/${fixtureFilename('nhmSearch', query)}`
writeFileSync(out, JSON.stringify(getNodeResults('cap') ?? [], null, 2))
console.error('wrote', out)
```
If Cloudflare challenges the non-browser call (HTTP 403/503 with HTML), stop and use the browser route; note the outcome in the commit message because it answers one of the handoff's open questions.

- [ ] **Step 4: Run the full fixture suites**

Run: `npx vitest run src/__tests__/fixtureConformance.test.ts src/__tests__/examplesNoSecrets.test.ts`
Expected: PASS. If `_pid missing` violations appear, inspect the offending record in the file: if the portal genuinely returns records without `occurrenceID`, relax that one check to "when `nhm.occurrenceID` is non-empty, `_pid` equals it" and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add public/fixtures/nhmSearch-stonehenge.json public/fixtures/nhmSearch-wordsworth.json src/__tests__/fixtureConformance.test.ts
git commit -m "feat(nhm): stonehenge + wordsworth fixtures and nhm conformance assertions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Source profile, lineage describer, QuickStart, connection suggestions

**Files:**
- Modify: `src/data/sourceProfiles.ts` (new entry after the `gbif` profile, ~line 98), `src/utils/lineageDescribers.ts` (new `NHM_FACETS` after `ARIADNE_FACETS` line 77; registry entry after `gbifSearch` ~line 87), `src/components/ConnectionSuggestions.tsx` (`NODE_PARAM_HANDLES` after `hsdsSearch` line 41; `DATA_SOURCES` line 66; `SUGGESTIONS.param` after `hsdsSearch` line 132), `src/nodes/QuickStartNode.tsx` (`ID_PREFIX` line 64; `VALID_SEARCH_TYPES` line 79; prompt block after gbifSearch's at line 96; coordinate list line 155; "eight" at line 163; a rule after line 184; `bases` after `hsdsSearch` ~line 285)
- Test: `src/__tests__/lineageDescribers.test.ts`

- [ ] **Step 1: Write the failing lineage test**

Append inside the `describe('lineageDescribers')` block, after the gbifSearch test:
```ts
  it('nhmSearch: resource in the service label, facets, capped totals', () => {
    const s = describeNode(mk('nhmSearch', {
      inlineQuery: 'stonehenge', resource: 'specimens', collectionCode: 'MIN', year: '1920', count: 103,
    }))
    expect(s).toContain('NHM Data Portal (specimens)')
    expect(s).toContain('"stonehenge"')
    expect(s).toContain('Collection=MIN')
    expect(s).toContain('Year=1920')
    expect(s).toContain('103 results')
    expect(s).not.toContain('Resource=')

    const t = describeNode(mk('nhmSearch', { inlineQuery: 'x', resource: 'indexlots', count: 2000, _capped: true, _total: 2500 }))
    expect(t).toContain('(index lots)')
    expect(t).toContain('2000 of 2500')
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/lineageDescribers.test.ts`
Expected: FAIL — generic fallback text lacks "NHM Data Portal (specimens)".

- [ ] **Step 3: Lineage describer**

In `src/utils/lineageDescribers.ts` after `ARIADNE_FACETS`:
```ts
const NHM_FACETS: Array<[string, string]> = [
  ['collectionCode', 'Collection'], ['country', 'Country'], ['year', 'Year'],
  ['typeStatus', 'Type status'], ['basisOfRecord', 'Basis of record'],
]
```
In the registry after the `gbifSearch` entry:
```ts
  nhmSearch: d => describeSearch(
    `the NHM Data Portal (${d.resource === 'indexlots' ? 'index lots' : 'specimens'})`, NHM_FACETS,
  )(d),
```

- [ ] **Step 4: Connection suggestions**

`NODE_PARAM_HANDLES` after `hsdsSearch`:
```ts
  nhmSearch: [
    { id: 'query', label: 'query' },
    { id: 'limit', label: 'limit' },
  ],
```
`DATA_SOURCES`: add `'nhmSearch'` after `'hsdsSearch'`.
`SUGGESTIONS.param` after the `hsdsSearch` row:
```ts
    { type: 'nhmSearch',        label: 'NHMSearch',             sub: 'query / limit',               color: '#5e6b2b', targetHandle: null },
```

- [ ] **Step 5: QuickStart**

- `ID_PREFIX`: add `nhmSearch: 'nhm',` after `gbifSearch`.
- `VALID_SEARCH_TYPES`: add `'nhmSearch'` after `'gbifSearch'`.
- Prompt, insert after the gbifSearch block (after line 96, before `lldsSearch`):
```
nhmSearch — Natural History Museum (London) Data Portal
  Domain: The NHM's own specimen catalogue — botany, zoology, entomology, palaeontology AND mineralogy/petrology (rocks, minerals, meteorites, building stone)
  Coverage: ~6.3 million specimen records. The ONLY route to NHM mineralogy and petrology — GBIF holds none of it. Keeps locality text, catalogue numbers, sub-department and per-image rights that GBIF flattens. Specimens collected at UK heritage sites (e.g. Stonehenge sarsen and dolerite samples) are findable by place name
  Best for: Geology, mineral and rock specimens, stone from UK heritage sites and monuments, institution-level specimen detail, comparing the home-institution record with GBIF's aggregator copy (join on nhm.gbifID = gbif.key)
  Params: inlineQuery (free text across all fields), inlineLimit, collectionCode ("BOT"|"ZOO"|"BMNH(E)"|"PAL"|"MIN"), country (e.g. "United Kingdom"), year (exact year only), basisOfRecord ("PreservedSpecimen"|"FossilSpecimen"|"Occurrence" for minerals and rocks)
```
- Line 155: `(gbifSearch, nhmSearch, ariadneSearch, hsdsSearch have coordinates)`.
- Line 163: `"<one of the ten search node types above>"`.
- Add a rule after the gbifSearch rule (line 184):
```
- For questions about geology, minerals, rocks, meteorites or building stone use nhmSearch (GBIF has no NHM mineralogy); for UK natural-history questions use gbifSearch and nhmSearch together so the aggregator and home-institution views can be compared
```
- `bases` in `buildSearchData`, after `hsdsSearch`:
```ts
    nhmSearch: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      resource: 'specimens', sort: 'relevance',
      collectionCode: '', country: '', year: '', typeStatus: '', basisOfRecord: '',
      useFixture: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
```

- [ ] **Step 6: Source profile**

Insert after the `gbif` profile object (after line 98) in `src/data/sourceProfiles.ts`:
```ts
  {
    source: 'nhm',
    label: 'NHM Data Portal',
    url: 'https://data.nhm.ac.uk/',
    coverage: 'Natural History Museum, London specimen collection, about 6.3 million records across entomology, zoology, botany, palaeontology and mineralogy; plus the Index Lot collection. Darwin Core fields. Images for a minority of records, served over IIIF.',
    researchUse: 'Home-institution view of NHM specimens alongside the GBIF aggregator view: join on nhm.gbifID ↔ gbif.key. The only route to NHM mineralogy and petrology (rocks, minerals, meteorites, building stone), which GBIF does not hold. Locality text, catalogue numbers, sub-department and per-image rights are preserved where GBIF flattens them. Specimens collected at UK heritage sites are discoverable by place name.',
    limitations: 'Coordinates are present on a minority of records and may be deliberately coarsened for sensitive species. Dates arrive as separate year/month/day strings (composed into `date`; many records have year only). `scientificName` is empty or a rock name for mineralogy and some palaeontology. Filters take one value per field and `year` is exact match. The portal asks callers to identify themselves by User-Agent and to stay under 5 requests/second; a browser fetch cannot set the agent, so this node identifies itself only by origin and paces pages at 250 ms. Fetch all is capped at 2,000 records. Mineralogy and petrology records are not in GBIF, so this node is the only route to them.',
    coreFields: ['title', 'description', 'creator', 'date', 'subject', 'country', 'decimalLatitude', 'decimalLongitude'],
    fields: [
      { path: 'title',               label: 'Title',            description: 'scientificName → determinationFiledAs → catalogNumber fallback chain', type: 'string', mapsToCore: 'title' },
      { path: 'description',         label: 'Locality',         description: 'Locality text, with habitat appended when present', type: 'string', mapsToCore: 'description' },
      { path: 'creator',             label: 'Recorded by',      description: 'Collector name(s) — array when more than one', type: 'string[]', mapsToCore: 'creator' },
      { path: 'date',                label: 'Date',             description: 'Composed YYYY[-MM[-DD]] from year/month/day', type: 'string', mapsToCore: 'date' },
      { path: 'subject',             label: 'Subjects',         description: '[collectionCode, subDepartment, family] — facet on these in FieldDistribution', type: 'string[]', mapsToCore: 'subject' },
      { path: 'decimalLatitude',     label: 'Latitude',         description: 'Parsed from the string payload; null when absent — minority of records', type: 'number', mapsToCore: 'decimalLatitude' },
      { path: 'decimalLongitude',    label: 'Longitude',        description: 'Parsed from the string payload; null when absent', type: 'number', mapsToCore: 'decimalLongitude' },
      { path: 'nhm.occurrenceID',    label: 'Occurrence ID',    description: 'CETAF stable identifier; also written to _pid and used in the record URL', type: 'string' },
      { path: 'nhm.catalogNumber',   label: 'Catalogue number', description: 'NHM catalogue / accession number', type: 'string' },
      { path: 'nhm.collectionCode',  label: 'Collection',       description: 'BOT, ZOO, BMNH(E) (entomology), PAL, MIN', type: 'string' },
      { path: 'nhm.subDepartment',   label: 'Sub-department',   description: 'e.g. Petrology, Anthropology — finer than collectionCode', type: 'string' },
      { path: 'nhm.scientificName',  label: 'Scientific name',  description: 'Taxon name; a rock or mineral name (or empty) for MIN', type: 'string' },
      { path: 'nhm.typeStatus',      label: 'Type status',      description: 'Holotype, Paratype, … when the specimen is a nomenclatural type', type: 'string' },
      { path: 'nhm.gbifID',          label: 'GBIF ID',          description: 'GBIF occurrence key where the record has been pushed to GBIF (absent for MIN)', type: 'string', notes: 'Joins to gbif.key' },
      { path: 'nhm.thumbnail',       label: 'Thumbnail',        description: 'JPEG thumbnail of the first associated image — use in ImageView Images mode', type: 'url' },
      { path: 'nhm.iiifInfo',        label: 'IIIF info.json',   description: 'IIIF Image API 3 service document for the first image (no Presentation manifest exists)', type: 'iiif', notes: 'Tile id inside info.json carries an mss: prefix' },
    ],
    correspondences: [
      { field: 'nhm.gbifID',         otherSource: 'gbif',    otherField: 'gbif.key',            relationship: 'join-candidate', notes: 'Same specimen: NHM home record ↔ GBIF aggregator copy' },
      { field: 'nhm.scientificName', otherSource: 'gbif',    otherField: 'gbif.scientificName', relationship: 'direct',         notes: 'Same Darwin Core term' },
      { field: 'nhm.catalogNumber',  otherSource: 'gbif',    otherField: 'gbif.catalogNumber',  relationship: 'direct',         notes: 'Same Darwin Core term' },
      { field: 'decimalLatitude',    otherSource: 'ariadne', otherField: 'decimalLatitude',     relationship: 'join-candidate', notes: 'Co-locate specimens with archaeological sites' },
      { field: 'decimalLatitude',    otherSource: 'hsds',    otherField: 'decimalLatitude',     relationship: 'join-candidate', notes: 'Co-locate specimens with heritage science records' },
      { field: 'description',        otherSource: 'ariadne', otherField: 'spatialCoverage',     relationship: 'similar',        notes: 'Free-text locality vs place name' },
    ],
  },
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npx vitest run src/__tests__/lineageDescribers.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean, 0 errors.

- [ ] **Step 8: Commit**

```bash
git add src/data/sourceProfiles.ts src/utils/lineageDescribers.ts src/components/ConnectionSuggestions.tsx src/nodes/QuickStartNode.tsx src/__tests__/lineageDescribers.test.ts
git commit -m "feat(nhm): source profile, lineage describer, QuickStart planning and connection suggestions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs + final gates

**Files:**
- Modify: `README.md` (row after GBIFSearch, line 91), `CLAUDE.md` (Discovering table row after `gbifSearch`; proxy note), `docs/handoff-nhm-search-node.md` (append an "Implementation notes" section), `docs/federation-baseline.md` only if it has a per-service table (check; add an NHM row mirroring GBIF's if so, else skip).

- [ ] **Step 1: README row** (after line 91)

```
| **NHMSearch** | [NHM Data Portal](https://data.nhm.ac.uk/) | Natural History Museum, London specimen catalogue (~6.3M records) via CKAN `datastore_search`; the only route to NHM mineralogy/petrology, which GBIF lacks. Direct browser fetch (permissive CORS, no proxy). Inline fields: `query`, `limit`, **Fetch all** (capped at 2,000, paced 250 ms/page), **resource** (Specimens / Index lots), sort (relevance / year). Filters: Collection (BOT/ZOO/BMNH(E)/PAL/MIN), Country, Year (exact), Type status, Basis of record — one value each. Records carry `nhm.*` wholesale plus `nhm.thumbnail` (ImageView Images mode) and `nhm.iiifInfo`; `nhm.gbifID` joins to `gbif.key`. Fixture mode supported. |
```

- [ ] **Step 2: CLAUDE.md**

Discovering table, after the `gbifSearch` row:
```
| `nhmSearch` | `NHMSearchNode` | Direct CORS fetch (POST JSON to `datastore_search`); **no proxy — `robots.txt` disallows `/api/`**. Thin config over `BackboneSearchNode` (resource body row, single-select sort, five single-value filters). Runner is bespoke (limit/offset + `result.total`, GBIF-shaped) over `runnerHelpers.ts`; first page doubles as the total probe; 250 ms page pacing; Fetch all capped at 2,000 (`_capped`/`_total` amber convention). `nhm.*` wholesale + derived `nhm.thumbnail`/`nhm.iiifInfo` (no Presentation manifest — ImageView IIIF mode not yet wired for bare info.json; follow-up). `_pid` = `occurrenceID`. Fixtures: `stonehenge`, `wordsworth`. |
```
Proxy Rules table: add a one-line note under the table: `NHM (`nhmSearch`) is deliberately direct-fetch: the portal's robots.txt disallows `/api/` and asks for an identifying User-Agent, which only a server could set — do not add a proxy row without clearing both (handoff open questions).`

- [ ] **Step 3: Handoff doc — append**

```markdown
## Implementation notes (added at implementation, 2026-10-20)

- Built on the `BackboneSearchNode` shell (not a GBIF-style bespoke layout); handle contract pinned in `backboneHandles.test.ts`.
- Fetch-all cap 2,000 (the factory ARIADNE uses has no cap; Bodleian's 500 and GBIF's 40-page cap were the real precedents).
- First page doubles as the total probe; no separate `limit:1` request.
- ImageView IIIF mode still needs a bare-`info.json` image-service path (`extractManifestEntries`/`fetchImageInfo` in `ImageViewNode.tsx`) — `nhm.iiifInfo` is written ready for it. Follow-up task.
- Cloudflare behaviour for non-browser callers: <fill in from Task 4 fallback outcome, or "not tested — fixtures captured in-browser">.
```

- [ ] **Step 4: All four gates + build**

Run: `npm run lint && npm run typecheck && npx vitest run && npx vite build`
Expected: 0 lint errors, tsc clean, all suites green, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md docs/handoff-nhm-search-node.md
git commit -m "docs(nhm): README/CLAUDE.md node rows, proxy note, handoff implementation notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification (end to end)

Automated — must all be green on the branch:
```
npm run lint && npm run typecheck && npx vitest run && npx vite build
```
New suites: `nhmAdapter.test.ts`, `runNHMNode.test.ts`; extended: `backboneHandles.test.ts`, `fixtureConformance.test.ts`, `lineageDescribers.test.ts`.

Manual acceptance (`npm run dev`, port 5174; from the handoff):
1. NHMSearch, query `Stonehenge`, limit 200, Fetch all → ~142 records; TableOutput shows a mix of BOT, MIN, PAL and ZOO in `nhm.collectionCode` (tick "expand namespaces").
2. Same with Collection = MIN → ~103 records, titles like "Spotted Dolerite"; `nhm.gbifID` column empty.
3. GBIFSearch `q=Stonehenge` beside NHMSearch, both into one TableOutput: GBIF ~39, NHM ~142; `nhm.gbifID` values match `gbif.key` on the overlap. (GBIF node exposes no dataset-key filter — note as follow-up; one-field change.)
4. NHMSearch → MapOutput: botanical records with coordinates plot near Salisbury Plain.
5. NHMSearch → ImageView (Images mode): pick `nhm.thumbnail` in the field picker; a record with media shows its thumbnail. IIIF mode: not available for NHM yet (follow-up).
6. Tick 📦 with query `stonehenge` → `📦 142 (fixture)` loads offline.
7. Citation node lists the NHM entry with the `data.nhm.ac.uk/object/…` URL.
8. QuickStart with "sarsen stones and building stone from Stonehenge" proposes an `nhmSearch` node.

## Follow-ups (out of scope, recorded for the backlog)

- ImageView: image-service (`info.json`) path without a Presentation manifest; must use the `id` inside info.json (`media/mss:{assetID}`), not the record's identifier.
- GBIF node: `datasetKey` filter for the aggregator-vs-institution demo.
- `vds_multi_query` advanced mode (geo/range filters, cross-resource).
- Index Lots field mapping beyond the shared Darwin Core keys.
