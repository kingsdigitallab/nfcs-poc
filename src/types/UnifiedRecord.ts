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
 * Namespace conventions:
 *  - `record.gbif.*` is the canonical home for raw GBIF occurrence fields
 *    (e.g. record.gbif.scientificName, record.gbif.datasetKey). The GBIF adapter
 *    dual-writes domain-specific fields here AND to the top-level normalised fields
 *    for backward compatibility. New code should read from record.gbif.*.
 *  - Similarly, record.llds.*, record.ads.*, etc. hold the raw service payload.
 *
 * Schema.org alignment:
 *  - Cross-service normalised fields carry @see schema.org annotations below.
 *    This is documentation-only; no runtime validation is performed.
 *
 * Adding a new service:
 *  1. Add an optional namespace key at the bottom of this interface.
 *  2. Create src/utils/<service>Adapter.ts that maps the raw response here.
 *  3. Existing output nodes require zero changes.
 */
export interface UnifiedRecord {
  /**
   * Globally unique id — service-prefixed, e.g. "gbif:12345" or "llds:20.500.14106/1234"
   * @see https://schema.org/identifier
   */
  id: string

  // ── Citation metadata ───────────────────────────────────────────────────────
  /** Populated by source runners; consumed by CitationNode and ExportNode. */
  _citation?: {
    service: string
    serviceUrl: string
    accessDate: string
    publisher?: string
    licence?: string
    query?: string
    recordId?: string
    title?: string
    url?: string
    pid?: string
    creator?: string | string[]
    date?: string
  }

  // ── Provenance ──────────────────────────────────────────────────────────────
  /** Source service identifier, e.g. "gbif" | "llds" | "ads" */
  _source?: string
  /** Native record identifier within the source service */
  _sourceId?: string | number
  /**
   * URL to the record in its native UI
   * @see https://schema.org/url
   */
  _sourceUrl?: string
  /**
   * Persistent identifier — DOI, handle, ARK, etc.
   * @see https://schema.org/identifier
   */
  _pid?: string
  /** True when this record was served from a local cache due to service unavailability */
  _cached?: boolean
  /** Human-authored gold-standard annotation, stored in notesStore (localStorage). */
  _note?: string

  // ── Cross-service normalised fields ─────────────────────────────────────────
  // These map the most useful field from each service to a common name.
  // A processing node that needs the raw original can find it in the namespace.

  /**
   * Best available display title: dc.title (LLDS), scientificName (GBIF), …
   * @see https://schema.org/name
   */
  title?: string
  /**
   * dc.description.abstract or dc.description
   * @see https://schema.org/description
   */
  description?: string
  /**
   * Author / creator — may be an array for multi-author records
   * @see https://schema.org/creator
   */
  creator?: string | string[]
  /**
   * Publication / event date
   * @see https://schema.org/datePublished
   */
  date?: string
  /**
   * Subject keywords — may be an array
   * @see https://schema.org/keywords
   */
  subject?: string | string[]
  /**
   * Language code, e.g. "en", "cy"
   * @see https://schema.org/inLanguage
   */
  language?: string
  /**
   * Resource type, e.g. "Text", "Dataset"
   * @see https://schema.org/additionalType
   */
  type?: string
  /**
   * Format, e.g. "text/plain"
   * @see https://schema.org/encodingFormat
   */
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
  /** @see https://schema.org/latitude */
  decimalLatitude?: number | null
  /** @see https://schema.org/longitude */
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
  /** Europeana namespace (provider, dataProvider, rights, thumbnail, shownAt, completeness) */
  europeana?: Record<string, unknown>
  /** ARIADNE portal namespace (temporal, country, allSpatial, contributor, ariadneSubject, …) */
  ariadne?: Record<string, unknown>
  /** Science Museum Group namespace (museum, accessionNumber, manifest, thumbnail, …) */
  smg?: Record<string, unknown>
  /** Victoria and Albert Museum namespace (objectType, place, manifest, iiifImageBase, thumbnail, …) */
  vam?: Record<string, unknown>

  // ── Geocoding enrichment ────────────────────────────────────────────────────
  /** Full geocoding result from GeocodingNode */
  geocoding?: {
    geocoded:            'auto' | 'native' | 'pending_review' | 'manual' | 'failed'
    geocode_source?:     'tgn' | 'wikidata' | 'nominatim' | 'native'
    geocode_uri?:        string
    geocode_candidates?: GeoCandidate[]
    place_raw?:          string
    place_cleaned?:      string
    place_terms?:        string[]   // all terms extracted by LLM (SmartGeocoder)
    confidence?:         number
  }

  // ckan?: Record<string, unknown>
}

/** A single gazetteer candidate returned by TGN, Wikidata, or Nominatim during geocoding. */
export interface GeoCandidate {
  source:       'tgn' | 'wikidata' | 'nominatim'
  uri:          string
  label:        string
  lat:          number
  lng:          number
  placeType?:   string
  parentLabel?: string
  tgnUri?:      string   // cross-ref from Wikidata → TGN, used for corroboration scoring
  score:        number   // final composite score [0–1]
}

/** A user-confirmed geocoding choice stored in node data for persistence. */
export interface GeoConfirmed {
  lat:    number
  lng:    number
  source: 'tgn' | 'wikidata'
  uri:    string
  label:  string
}
