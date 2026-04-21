/**
 * UnifiedRecord — the canonical shape that flows between all nodes.
 *
 * Rules:
 *  - Every adapter (GBIF, LLDS, ADS OAI-PMH, CKAN, …) must map its raw API
 *    response to UnifiedRecord[] before writing to node data.
 *  - Output nodes (Table, JSON, Download, …) ONLY consume UnifiedRecord[].
 *    They never touch raw API responses.
 *  - Service-specific fields that have no normalised equivalent live under a
 *    named namespace: record.gbif.datasetKey, record.llds.handle, etc.
 *    Downstream processing nodes access them there without re-parsing raw responses.
 *
 * Adding a new service:
 *  1. Add an optional namespace key at the bottom of this interface.
 *  2. Create src/utils/<service>Adapter.ts that maps the raw response here.
 *  3. Existing output nodes require zero changes.
 */
export interface UnifiedRecord {
  /** Globally unique id — service-prefixed, e.g. "gbif:12345" or "llds:20.500.14106/1234" */
  id: string

  // ── Provenance ──────────────────────────────────────────────────────────────
  /** Source service identifier, e.g. "gbif" | "llds" | "ads" */
  _source?: string
  /** Native record identifier within the source service */
  _sourceId?: string | number
  /** URL to the record in its native UI */
  _sourceUrl?: string
  /** Persistent identifier — DOI, handle, ARK, etc. */
  _pid?: string
  /** True when this record was served from a local cache due to service unavailability */
  _cached?: boolean

  // ── Cross-service normalised fields ─────────────────────────────────────────
  // These map the most useful field from each service to a common name.
  // A processing node that needs the raw original can find it in the namespace.

  /** Best available display title: dc.title (LLDS), scientificName (GBIF), … */
  title?: string
  /** dc.description.abstract or dc.description */
  description?: string
  /** Author / creator — may be an array for multi-author records */
  creator?: string | string[]
  /** Publication / event date */
  date?: string
  /** Subject keywords — may be an array */
  subject?: string | string[]
  /** Language code, e.g. "en", "cy" */
  language?: string
  /** Resource type, e.g. "Text", "Dataset" */
  type?: string
  /** Format, e.g. "text/plain" */
  format?: string
  /** Collection name — MDS and other cultural-heritage sources */
  collection?: string

  // ── Geography / place (ADS, GBIF) ───────────────────────────────────────────
  /** Human-readable place name for the primary spatial coverage */
  spatialCoverage?: string
  /** ISO 3166 country name(s) */
  country?: string | string[]

  // ── Temporal coverage (ADS) ──────────────────────────────────────────────────
  /** Earliest date of temporal coverage (ISO 8601 or year string) */
  periodStart?: string
  /** Latest date of temporal coverage */
  periodEnd?: string
  /** Named period label, e.g. "Iron Age", "Medieval" */
  periodName?: string | string[]

  // ── Biodiversity-specific (GBIF) ────────────────────────────────────────────
  scientificName?: string
  kingdom?: string
  phylum?: string
  class?: string
  order?: string
  family?: string
  genus?: string
  species?: string
  eventDate?: string
  decimalLatitude?: number | null
  decimalLongitude?: number | null
  basisOfRecord?: string
  institutionCode?: string
  datasetName?: string

  // ── Service namespace fields ─────────────────────────────────────────────────
  /** Full raw GBIF occurrence object */
  gbif?: Record<string, unknown>
  /** Full raw LLDS DSpace item (id, handle, metadata array) */
  llds?: Record<string, unknown>
  /** ADS Data Catalogue namespace (temporal, country, allSpatial, …) */
  ads?: Record<string, unknown>
  /** ADS Library catalogue namespace (fields by CSS class, divTexts, url) */
  adsLibrary?: Record<string, unknown>
  /** Museum Data Service namespace (collection, material, place, …) */
  mds?: Record<string, unknown>
  // ckan?: Record<string, unknown>
  // europeana?: Record<string, unknown>
}
