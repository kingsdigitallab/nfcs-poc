# Federation Baseline — what makes a good data-service node

This document defines the characteristics that make an external data service a good
candidate for federation in this application, and scores the two strongest existing
integrations — **GBIF** and **Europeana** — against that checklist as worked examples.
Use it when evaluating a new service and when building its node (see the Registration
Checklist in `CLAUDE.md`).

## The checklist

| # | Criterion | Why it matters | What "good" looks like |
|---|-----------|----------------|------------------------|
| 1 | **Open, documented REST API** | Scrapers (MDS) and session-dance integrations (ADS Library) are fragile and break silently | Versioned JSON API with published docs and stable base URL |
| 2 | **Permissive CORS** | No-CORS services need a proxy entry in `server/proxies.mjs` (dev + prod), an extra moving part per deployment | `Access-Control-Allow-Origin: *` — direct browser fetch |
| 3 | **Stable pagination** | The runner must fetch predictably; caps and cursor quirks leak into UX (amber badges, hard caps) | Offset/page params or a documented cursor; total count reported |
| 4 | **Persistent identifiers** | Records must be citable and joinable across time (`_pid`, MergeByQID, citations) | DOI / Handle / ARK / stable accession numbers on every record |
| 5 | **Machine-readable licence** | Export and reuse in research outputs requires rights clarity per record | Licence URI or SPDX-like code in the record payload |
| 6 | **Field completeness** | The cross-service normalised fields (`title`, `description`, `creator`, `date`, `subject`) drive every mixed-source table, timeline and map | High population rates for the core fields; structured dates; coordinates where meaningful |
| 7 | **Namespace hygiene** | The adapter must map to `UnifiedRecord` without inventing top-level keys (enforced by `fixtureConformance.test.ts`) | Raw payload preserved wholesale under `record.<service>.*` |
| 8 | **Fixture support** | Offline workshops and CI depend on committed fixtures | Deterministic responses for a given query (no session tokens in payloads) |
| 9 | **Rate limits & availability** | Run All fans out in parallel waves; a fragile service degrades whole workflows | Documented limits comfortably above workshop usage; no CAPTCHA/bot walls (cf. Cloudflare-blocked ADS) |
| 10 | **Citation metadata** | `_citation` stamps power CitationNode bibliographies | Publisher, service URL and record URL derivable from the response |

## Worked scorecard: GBIF

`https://api.gbif.org/v1/occurrence/search` — biodiversity occurrences.

| # | Criterion | Score | Notes |
|---|-----------|-------|-------|
| 1 | Open REST API | ✅ | Extensively documented, versioned (`/v1`), no auth for search |
| 2 | CORS | ✅ | Direct browser fetch; the only service needing no proxy at all |
| 3 | Pagination | ✅ | `limit`/`offset`, max 300/request, exact `count` returned |
| 4 | PIDs | ⚠️ | Stable occurrence keys and dataset DOIs, but occurrence-level DOIs absent; `_sourceUrl` is stable |
| 5 | Licence | ✅ | Per-record `license` field (CC0/CC-BY/CC-BY-NC) in the raw payload |
| 6 | Field completeness | ⚠️ | Coordinates ~100%; taxonomy strong on curated datasets but `scientificName` can be sparse (42% in one fixture) — the adapter's title fallback chain exists for this reason; no free-text `description` |
| 7 | Namespace hygiene | ✅ | Raw occurrence stored wholesale under `gbif.*`; no flat domain fields (post task-3.2) |
| 8 | Fixtures | ✅ | Deterministic; 30+ committed fixtures |
| 9 | Rate limits | ✅ | Generous public limits; no bot walls |
| 10 | Citation metadata | ✅ | Publisher, institution codes, dataset names all present |

**Overall: reference-quality.** GBIF is the baseline for API ergonomics; its weakness is
domain-specific sparseness of humanities-relevant fields, which is inherent to a
biodiversity service, not an API flaw.

## Worked scorecard: Europeana

`https://api.europeana.eu/record/v2/search.json` — pan-European cultural heritage.

| # | Criterion | Score | Notes |
|---|-----------|-------|-------|
| 1 | Open REST API | ✅ | Documented Search API; requires a (free) API key |
| 2 | CORS | ✅ | Direct browser fetch |
| 3 | Pagination | ⚠️ | Cursor-based to 1,000 records; cursor must be threaded (the runner stays bespoke — see `searchRunnerFactory.ts` notes) |
| 4 | PIDs | ✅ | Europeana record IDs are persistent URIs; `shownAt` links to the providing institution |
| 5 | Licence | ✅ | `rights` URI on every record (Creative Commons / RightsStatements.org) — best-in-class |
| 6 | Field completeness | ⚠️ | Title/type near-100%; creator/description variable across 4,000+ providers; `completeness` score included per record, which the node surfaces |
| 7 | Namespace hygiene | ✅ | `europeana.*` namespace (provider, dataProvider, rights, thumbnail, shownAt, completeness) |
| 8 | Fixtures | ✅ | Deterministic; fixtures committed |
| 9 | Rate limits | ✅ | Key-scoped quotas, ample for workshops |
| 10 | Citation metadata | ✅ | Provider + dataProvider + rights per record |

**Overall: reference-quality for cultural heritage.** The licence/rights modelling is the
standard other services should be held to; the aggregator trade-off is variable
per-provider completeness, which the `completeness` score makes visible rather than
hiding.

## Using this checklist for a new service

1. Score the candidate against the table (a ⚠️ on 1, 2 or 9 usually means proxy work or
   fragility — budget for it; a ❌ on 1 means you are writing a scraper that will break).
2. Follow the Registration Checklist in `CLAUDE.md`; store the raw payload wholesale
   under `record.<service>.*` and map only genuinely cross-service fields to the top
   level.
3. Commit fixtures for at least one query and confirm `npx vitest run` —
   `fixtureConformance.test.ts` enforces the record contract automatically.
4. Add the service's profile to `src/data/sourceProfiles.ts` so SourceProfile can
   explain it to users.
