# Handoff: NHMSearch node for the NFCS proof of concept

Status: brief for implementation. Written 2026-10-20 from live tests against the NHM Data Portal API; nothing here has been agreed with NHM, so treat the service as a public API we are using politely rather than a partner integration.

Repo: `kingsdigitallab/nfcs-poc`. Read `CLAUDE.md`, `.claude/skills/new-node/SKILL.md` and `docs/federation-baseline.md` before starting; this brief supplies the service-specific facts and the decisions already taken, not the registration mechanics, which the skill covers.

## Goal

Add a `NHMSearch` data-source node that queries the Natural History Museum Data Portal (CKAN with the NHM `ckanext-versioned-datastore` extension), maps results to `UnifiedRecord`, and lets ImageView open specimen images over IIIF. First cut is the plain CKAN `datastore_search` route; the NHM-specific `vds_multi_query` interface is a later advanced mode, not part of this task.

Why it earns a place on the canvas: the existing GBIF node already reaches about five-sixths of NHM's specimens, but GBIF holds none of the 377k mineralogy and petrology records, flattens locality text, and drops the institution's own fields and per-image rights. An NHM node plus the GBIF node is a clean demonstration of aggregator route versus home-institution route, joinable on `gbifID`.

## Verified facts about the service (2026-10-20)

All of these were observed in a browser, cross-origin from `https://nfcs-poc.sites.er.kcl.ac.uk`.

| Property | Finding |
| --- | --- |
| Base | `https://data.nhm.ac.uk/api/3/action/` |
| Auth | None for search. Portal asks for a user agent naming the project, under 5 requests/second, and caching of results |
| CORS | Permissive. Cross-origin `fetch` from the PoC domain succeeded for `datastore_search`, `vds_multi_query` and `package_search`. No proxy row needed |
| Bot protection | Cloudflare is in front of the site (`cdn-cgi/rum` beacons). Browser-originated calls were not challenged. A server-side call could not be tested; `robots.txt` disallows `/api/`, so non-browser fetchers that honour robots will refuse it. Not a problem for the direct-browser design, but do not add a server-side proxy route without checking this |
| Main resource | Specimen collection, `resource_id = 05ff2255-c38a-40c9-b657-4ccb55ab2feb`, ~6.3M records |
| Second resource | Index lots, `resource_id = bb909597-dedf-427d-8c04-4c02b3a24db3` (package `collection-indexlots`) |
| Collections in specimen resource | `collectionCode` facet: `bmnh(e)` 2,715,772 · `zoo` 1,328,032 · `bot` 1,244,389 · `pal` 632,399 · `min` 377,133 (facet values are lower-cased; filter values are upper-case, e.g. `MIN`) |
| GBIF overlap | NHM's GBIF dataset `7e380070-f762-11e1-a439-00145eb45e9a` holds 5.91M of these; MIN is absent from GBIF entirely. Specimen records carry `gbifID` where pushed |
| Record page | `https://data.nhm.ac.uk/object/{occurrenceID}` |
| Images | `associatedMedia[].identifier` = `https://data.nhm.ac.uk/media/{assetID}`. Appending `/info.json` returns a IIIF Image API 3, level 2 service document. `/thumbnail` and `/preview` return JPEGs. Standard IIIF request form (`/full/!400,400/0/default.jpg`) works |
| IIIF quirk | The service `id` inside `info.json` is `https://data.nhm.ac.uk/media/mss:{assetID}` (note the `mss:` prefix). Use the `id` from `info.json` for tile requests; do not build it from the record's `identifier` |
| Licence | Dataset-level CC0 for specimen metadata (per NHM's own statements); per-image `license` URI (CC BY 4.0) and `rightsHolder` inside `associatedMedia`. Record payloads carry no record-level licence field |

## Request and response

### `datastore_search` (use this)

`POST https://data.nhm.ac.uk/api/3/action/datastore_search` with a JSON body, or GET with query params; both work.

```json
{ "resource_id": "05ff2255-c38a-40c9-b657-4ccb55ab2feb",
  "q": "Stonehenge",
  "filters": { "collectionCode": "BOT", "year": "1882" },
  "sort": "year desc",
  "fields": "scientificName,year,decimalLatitude",
  "limit": 100,
  "offset": 0 }
```

Observed behaviour of each parameter:

- `q` free text across all fields. A field-scoped object (`{"locality": "Stonehenge"}`) returned the same count as free text, so assume it is ignored.
- `filters` object of field: value, ANDed. Values are strings (`"year": "1882"`). An array value (`{"collectionCode": ["BOT","ZOO"]}`) returned 0, so "any of" is not supported here even though stock CKAN allows it. Offer one value per field, or run two nodes.
- `sort` as `"field asc|desc"` works.
- `fields` comma-separated list trims the payload to those keys.
- `limit` / `offset` paging. Max page size was not probed; 100 worked. Assume 100 until tested higher.
- `facets` returns counts for a named field alongside results (`"facets": "collectionCode"`).

Response:

```json
{ "success": true,
  "result": {
    "total": 142,
    "records": [ { ...flat Darwin Core record... } ],
    "fields": [ { "id": "scientificName", "type": "string" }, ... ],
    "facets": { "collectionCode": { "values": { "min": 103, "bot": 26 } } },
    "after": null } }
```

Records are flat, one per specimen. Observed keys on a botanical record:

`_id, institutionCode, otherCatalogNumbers, basisOfRecord, collectionCode, occurrenceStatus, decimalLatitude, decimalLongitude, coordinateUncertaintyInMeters, verbatimLongitude, verbatimLatitude, locality, country, stateProvince, continent, higherGeography, geodeticDatum, catalogNumber, recordNumber, occurrenceID, recordedBy, scientificName, scientificNameAuthorship, phylum, order, family, genus, specificEpithet, higherClassification, fieldNumber, habitat, day, month, year, created, subDepartment, collectionKind, determinationNames, determinationFiledAs, gbifID, gbifIssue, modified, associatedMedia, associatedMediaCount`

Mineralogy records differ: `basisOfRecord: "Occurrence"`, `scientificName` holds a rock or mineral name (`"Sarsen stone"`, `"Spotted Dolerite"`) or is empty, `subDepartment: "Petrology"`, no `gbifID`. Palaeontology includes an "Anthropology" sub-department with `collectionKind: "Artefact"`.

All scalar values are strings, including coordinates and `year`. `recordedBy` is an array of strings.

### `vds_multi_query` (not this task; recorded for the advanced mode)

What the portal's own search page calls. `POST .../vds_multi_query` with `{ "query": { "search": "...", "filters": { "and": [ { "string_equals": { "fields": ["country"], "value": "United Kingdom" } } ] } }, "resource_ids": [...], "size": 100 }`. Returns `{ total, after, records: [ { data: {...}, resource: "..." } ] }` with cursor paging via `after`. Filter grammar is published at `https://data.nhm.ac.uk/querySchemas/v1.0.0/v1.0.0.json` and supports geo and range filters that `datastore_search` cannot express. A companion `vds_multi_fields` action lists fields.

## Adapter: `src/utils/nhmAdapter.ts`

Model on `gbifAdapter.ts` (same vocabulary). Store the raw record wholesale under `nhm.*`; map only cross-service fields to the top level, per the namespace-hygiene rule in `federation-baseline.md`.

| UnifiedRecord | Source | Notes |
| --- | --- | --- |
| `id` | `nhm:${occurrenceID}` | fall back to `nhm:${_id}` if `occurrenceID` is empty; never `Math.random()` |
| `_source` | `'nhm'` | |
| `_sourceId` | `occurrenceID` | |
| `_sourceUrl` | `https://data.nhm.ac.uk/object/${occurrenceID}` | |
| `_pid` | `occurrenceID` | this is the CETAF stable identifier; set it, unlike the GBIF adapter |
| `_citation` | service "Natural History Museum Data Portal", publisher "The Trustees of the Natural History Museum, London", service URL `https://data.nhm.ac.uk/` | stamp via the same helper the other runners use |
| `title` | `scientificName` → `determinationFiledAs` → `catalogNumber` → `NHM specimen ${_id}` | mineralogy and some palaeontology have no `scientificName`, so the `catalogNumber` step matters |
| `description` | `locality`, with `habitat` appended if present | GBIF flattens this; it is one reason to have the node |
| `creator` | `recordedBy` (array passes through) | |
| `date` | compose `year-month-day` with zero-padding, truncating to whatever parts exist (`1882`, `1882-06`, `1882-06-18`) | no `eventDate` field; TimelineView accepts bare years |
| `subject` | `[collectionCode, subDepartment, family].filter(Boolean)` | gives FieldDistribution something to facet on |
| `country` | `country` | |
| `decimalLatitude` / `decimalLongitude` | `parseFloat`, `null` if NaN | strings in the payload; MapOutput needs numbers |
| `nhm.*` | the whole record | |

Image helpers, either in the adapter or a small `nhmMedia.ts`:

- `nhm.thumbnail` = `${associatedMedia[0].identifier}/thumbnail` when media exists.
- `nhm.iiifInfo` = `${associatedMedia[0].identifier}/info.json`.
- `nhm.manifest` is not available; there is no Presentation API manifest. Check how ImageView's IIIF mode is fed by `smg.manifest` / `bodleian.manifest` and add an image-service path (info.json without a manifest) if it does not have one. If that is more than a small change, scope it as a separate task and have the first cut set `nhm.thumbnail` only so the Images mode works.

## Runner: `src/utils/runNHMNode.ts`

`makeSearchRunner` in `searchRunnerFactory.ts` is written for the ARIADNE/HSDS page-and-size shape (`ESLikeResponse`). NHM is `limit`/`offset` with `result.total`, which is the GBIF shape, so start from `runGBIFNode.ts` and reuse `runnerHelpers.ts` rather than forcing the factory, unless its param names turn out to be configurable; the factory's own header says not to force-fit.

Requirements:

- Resolve `query`, `limit` and `resourceId` through the wired-handle-then-node-data pattern the other runners use, so a Param node can drive the query.
- Pagination: probe with `limit: 1` for `total`, then page at 100 with `statusMessage` `Page N/M (X fetched)…`. Cap `Fetch all results` at a sensible ceiling (ARIADNE's cap is the precedent) and throttle to stay well under 5 requests/second, which the portal asks for.
- Pass `filters` only for fields the user has set; omit the key entirely when empty.
- Fixture mode as on every search node: `nhmSearch-{query}.json` in `public/fixtures/`. Commit fixtures for `stonehenge` (142 records, mixed BOT/MIN/PAL/ZOO) and `wordsworth` so both bundled workshop queries work. Capture them with the 💾 button after a live run; do not hand-edit.
- Never throw; end in `success` or `error` with a readable message. CKAN errors arrive as `{ "success": false, "error": { "message": ..., "__type": ... } }`; surface `error.message`.
- A browser `fetch` cannot set `User-Agent`, so the portal's request to identify ourselves cannot be met from the client. Note this in the source profile's limitations text and in the citation; if a proxy route is ever added, set the agent there.

## Component: `src/nodes/NHMSearchNode.tsx`

Follow `GBIFSearchNode.tsx` for layout and `ARIADNESearchNode.tsx` for the collapsible Filters panel.

Inline fields:

- `query` (text, wirable handle `query`)
- `limit` (integer, wirable handle `limit`, default 20)
- **Fetch all results** toggle
- `resource` dropdown: Specimens (default) · Index lots

Filters panel (each maps to one `filters` key, single value):

- `collectionCode` dropdown: BOT · ZOO · BMNH(E) (Entomology) · PAL · MIN
- `country` text
- `year` text (exact match only; say so in the placeholder)
- `typeStatus` text
- `basisOfRecord` dropdown: PreservedSpecimen · FossilSpecimen · Occurrence (minerals and rocks)

Sort dropdown: relevance (omit `sort`) · year asc · year desc.

Status footer shows `N of total` and, when `associatedMediaCount` is present on records, the count with images.

Sidebar group: Discovering and Gathering. Not advanced, not alpha.

## Registration

Follow the new-node skill checklist in full. Specific values:

- type key `nhmSearch`, id prefix `nhm`
- `NODE_IDENTITY` colour: pick something distinct from GBIF's; the two will often sit side by side
- `lineageDescribers.ts`: `Searched the NHM Data Portal (${resource}) for "${query}"${filters ? ' with filters: ' + filters : ''}; retrieved ${n} results.`
- `ConnectionSuggestions.tsx`: add to `DATA_SOURCES`, `NODE_PARAM_HANDLES` (`query`, `limit`) and `SUGGESTIONS.param`
- `QuickStartNode.tsx`: add to the plannable types with a one-line description that mentions mineralogy and UK heritage sites explicitly, so the planner reaches for it when GBIF would miss the geology
- `src/data/sourceProfiles.ts`: add the NHM profile (text below)
- no `server/proxies.mjs` change

### Source profile text

Coverage: Natural History Museum, London specimen collection, about 6.3 million records across entomology, zoology, botany, palaeontology and mineralogy; plus the Index Lot collection. Darwin Core fields. Images for a minority of records, served over IIIF.

Limitations: coordinates are present on a minority of records and may be deliberately coarsened for sensitive species; `year`/`month`/`day` rather than a single date field; `scientificName` is empty or a rock name for mineralogy and some palaeontology; filters take one value per field and `year` is exact match; the service asks callers to identify themselves by user agent, which a browser cannot do. Mineralogy and petrology records are not in GBIF, so this node is the only route to them.

Correspondence hints: `nhm.gbifID` joins to `gbif.key` for the same specimen; `nhm.scientificName` ↔ `gbif.scientificName`; `nhm.catalogNumber` ↔ `gbif.catalogNumber`; coordinates comparable with ARIADNE and HSDS spatial fields.

## Tests

- Extend `fixtureConformance.test.ts` to cover `nhmSearch-stonehenge.json`: every record has `id` starting `nhm:`, `_source === 'nhm'`, `_pid` set, numeric or null coordinates, no top-level keys outside the `UnifiedRecord` contract, raw payload under `nhm`.
- Unit-test the date composer (`1882` / `1882-06` / `1882-06-18` / missing year → `undefined`) and the title fallback chain against a BOT record, a MIN record (`"Sarsen stone"`) and a MIN record with empty `scientificName`.
- Gates: `npm run typecheck`, `npm run lint`, `npx vitest run`, `npx vite build`.

## Manual acceptance

1. `NHMSearch` with query `Stonehenge`, limit 200, Fetch all → 142 records; TableOutput shows a mix of BOT, MIN, PAL and ZOO.
2. Same with filter `collectionCode = MIN` → 103 records, titles like "Spotted Dolerite"; none have `gbifID`.
3. `GBIFSearch` with `q = Stonehenge` and NHM's dataset key, alongside `NHMSearch`, both into a TableOutput: the GBIF side returns 39, the NHM side 142, and `nhm.gbifID` values match `gbif.key` on the overlap. (If a dataset-key filter is not exposed on the GBIF node, note it as a follow-up; it is a one-field change.)
4. `NHMSearch` → `MapOutput`: botanical records with coordinates plot near Salisbury Plain.
5. `NHMSearch` → `ImageView`: a record with `associatedMedia` shows its thumbnail; in IIIF mode (if implemented) zooming fetches tiles from `media/mss:{assetID}`.
6. Fixture mode with `stonehenge` loads offline and passes the conformance test.
7. `Citation` node lists the NHM entry with the record URL.

## Out of scope for this task

- `vds_multi_query` advanced mode (geo and range filters, cross-resource search).
- A server-side proxy or user-agent handling.
- Index lot field mapping beyond what the specimen adapter already covers; confirm the Index Lots resource shares the Darwin Core keys before relying on it.
- Any contact with NHM about rate limits or agreement; that is being handled through the partner questionnaire.

## Open questions to carry back to the project

- Preferred interface from NHM's point of view: documented `datastore_search`, or the `vds_*` actions their own site uses and are more capable.
- Whether a named server-side agent is challenged by Cloudflare; relevant if the proxy route is ever needed for workshops.
- Maximum `limit` per request.
- Whether coarsened coordinates for sensitive species are flagged in the record (nothing obvious in the observed fields).

## Commit plan

Feature branch `feat/nhm-search-node`. One conventional commit per logical step: adapter + tests; runner; component + registration; fixtures + conformance; source profile + lineage + QuickStart; docs (README node table row, CLAUDE.md API reference entry, this file moved to `docs/`).

## Implementation notes (added at implementation, 2026-10-20)

- Built on the `BackboneSearchNode` shell (not a GBIF-style bespoke layout); handle contract pinned in `backboneHandles.test.ts`. Plan: `docs/superpowers/plans/2026-10-20-nhm-search-node.md`.
- Fetch-all cap 2,000 (the factory ARIADNE uses has no cap; Bodleian's 500 and GBIF's 40-page cap were the real precedents).
- First page doubles as the total probe; no separate `limit:1` request. Pages paced 250 ms apart.
- Fixtures were captured by driving the real runner (`runNHMNode` → adapter → `addCitation`) from a Node script, which produces exactly what the 💾 button writes. Stonehenge returned 142 records (MIN 103, BOT 26, PAL 7, BMNH(E) 3, ZOO 3; 26 with images; 31 with `gbifID`), matching this brief.
- **Open question partly answered:** the Node-side POST (no browser User-Agent) was served normally — Cloudflare did not challenge it. One sample, not a guarantee.
- ImageView IIIF mode still needs a bare-`info.json` image-service path (`extractManifestEntries`/`fetchImageInfo` in `ImageViewNode.tsx`); `nhm.iiifInfo` is written ready for it. Follow-up task. Images mode works today via `nhm.thumbnail`.
- The user-agent limitation is recorded in the NHM source profile; `RecordCitation` has no free-text field, so the citation carries the licence facts only.
- GBIF node has no `datasetKey` filter yet (acceptance step 3 of this brief) — follow-up, one-field change.
- `docs/federation-baseline.md` carries worked scorecards for GBIF and Europeana only; an NHM scorecard is a follow-up.
