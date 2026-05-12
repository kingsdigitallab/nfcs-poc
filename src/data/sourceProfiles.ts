/**
 * Authored schema profiles for each data source node.
 * Static — written once, not inferred at runtime.
 * Runtime field stats (population rates, sample values) are computed
 * by SourceProfileNode from actual upstream records.
 */

export interface FieldProfile {
  path: string
  label: string
  description: string
  type: 'string' | 'string[]' | 'number' | 'boolean' | 'url' | 'iiif'
  mapsToCore?: string  // equivalent UnifiedRecord core field, if any
  notes?: string
}

export interface SourceCorrespondence {
  field: string
  otherSource: string
  otherField: string
  relationship: 'direct' | 'similar' | 'different-vocab' | 'join-candidate'
  notes: string
}

export interface SourceProfile {
  source: string            // matches _source field in records
  label: string
  url: string
  coverage: string
  researchUse: string
  limitations: string
  coreFields: string[]      // which UnifiedRecord core fields this source populates reliably
  fields: FieldProfile[]
  correspondences: SourceCorrespondence[]
}

const profiles: SourceProfile[] = [
  {
    source: 'ariadne',
    label: 'ARIADNE',
    url: 'https://portal.ariadne-infrastructure.eu',
    coverage: 'Pan-European archaeological research data aggregator covering 40+ institutions across 23 countries. Dataset-level metadata for excavations, surveys, collections, and related resources.',
    researchUse: 'Locating archaeological datasets by site, period, cultural group, or Getty AAT subject. Use Contributor = "Archaeology Data Service" to filter to UK archaeology specifically. Fetch All retrieves complete result sets for broad queries.',
    limitations: 'Dataset-level metadata only — not object-level detail. Coverage weighted toward western Europe. Temporal metadata is often imprecise (period labels rather than point dates). Spatial coordinates represent site centroids and may be absent.',
    coreFields: ['title', 'description', 'date', 'subject', 'decimalLatitude', 'decimalLongitude'],
    fields: [
      { path: 'title',                    label: 'Title',            description: 'Title of the archaeological dataset or resource', type: 'string', mapsToCore: 'title' },
      { path: 'description',              label: 'Description',      description: 'Abstract or summary description of the resource', type: 'string', mapsToCore: 'description' },
      { path: 'date',                     label: 'Date',             description: 'Temporal coverage, typically as ISO date range or year', type: 'string', mapsToCore: 'date' },
      { path: 'subject',                  label: 'Subjects',         description: 'Controlled subject terms (array), drawn from multiple vocabularies', type: 'string[]', mapsToCore: 'subject' },
      { path: 'decimalLatitude',          label: 'Latitude',         description: 'Site centroid latitude — not always present', type: 'number', mapsToCore: 'decimalLatitude' },
      { path: 'decimalLongitude',         label: 'Longitude',        description: 'Site centroid longitude — not always present', type: 'number', mapsToCore: 'decimalLongitude' },
      { path: 'ariadne.contributor',      label: 'Contributor',      description: 'Institution that contributed the record to ARIADNE (e.g. "Archaeology Data Service")', type: 'string' },
      { path: 'ariadne.nativeSubject',    label: 'Native Subject',   description: 'Subject terms in the contributor\'s own vocabulary (not normalised)', type: 'string[]' },
      { path: 'ariadne.derivedSubject',   label: 'AAT Subject',      description: 'Subject terms mapped to Getty Art and Architecture Thesaurus (AAT)', type: 'string[]', notes: 'Use for cross-source subject matching' },
      { path: 'ariadne.period',           label: 'Period',           description: 'Archaeological period labels (e.g. Iron Age, Roman, Medieval)', type: 'string[]' },
      { path: 'ariadne.temporal',         label: 'Temporal',         description: 'Structured temporal coverage metadata', type: 'string' },
      { path: 'ariadne.publisher',        label: 'Publisher',        description: 'Publisher of the dataset', type: 'string' },
      { path: 'ariadne.identifier',       label: 'Identifier',       description: 'ARIADNE portal record identifier', type: 'url' },
    ],
    correspondences: [
      { field: 'title',                 otherSource: 'gbif',     otherField: 'title',              relationship: 'direct',           notes: 'Direct equivalent — both are resource titles' },
      { field: 'title',                 otherSource: 'bodleian', otherField: 'title',              relationship: 'direct',           notes: 'Direct equivalent' },
      { field: 'decimalLatitude',       otherSource: 'gbif',     otherField: 'decimalLatitude',    relationship: 'join-candidate',   notes: 'Direct join — co-locate sites with biodiversity occurrences' },
      { field: 'decimalLongitude',      otherSource: 'gbif',     otherField: 'decimalLongitude',   relationship: 'join-candidate',   notes: 'Direct join' },
      { field: 'ariadne.derivedSubject',otherSource: 'gbif',     otherField: 'subject',            relationship: 'different-vocab',  notes: 'Both are controlled vocabularies but AAT ≠ GBIF taxon hierarchy' },
      { field: 'ariadne.period',        otherSource: 'bodleian', otherField: 'date',               relationship: 'similar',          notes: 'Period labels vs point dates — not directly comparable but temporally related' },
    ],
  },

  {
    source: 'gbif',
    label: 'GBIF',
    url: 'https://www.gbif.org',
    coverage: 'Global Biodiversity Information Facility. Occurrence records for biological specimens and field observations from natural history collections and citizen science worldwide.',
    researchUse: 'Biodiversity occurrence data, species distributions, historical specimen records. Excellent coordinate coverage. Valuable for environmental humanities, landscape history, and co-location analysis with archaeological or cultural sites.',
    limitations: 'Biological focus only — no cultural heritage content. Historical records may have poor coordinate precision (county-level rather than GPS). Max 300 records per request in this implementation.',
    coreFields: ['title', 'date', 'decimalLatitude', 'decimalLongitude'],
    fields: [
      { path: 'title',                  label: 'Title',             description: 'Formatted occurrence label combining scientific name and location', type: 'string', mapsToCore: 'title' },
      { path: 'date',                   label: 'Event Date',        description: 'Date of observation or collection', type: 'string', mapsToCore: 'date' },
      { path: 'decimalLatitude',        label: 'Latitude',          description: 'Occurrence latitude — very high population rate', type: 'number', mapsToCore: 'decimalLatitude' },
      { path: 'decimalLongitude',       label: 'Longitude',         description: 'Occurrence longitude — very high population rate', type: 'number', mapsToCore: 'decimalLongitude' },
      { path: 'gbif.scientificName',    label: 'Scientific Name',   description: 'Full taxonomic name of the observed organism', type: 'string' },
      { path: 'gbif.kingdom',           label: 'Kingdom',           description: 'Taxonomic kingdom (Animalia, Plantae, Fungi, etc.)', type: 'string' },
      { path: 'gbif.family',            label: 'Family',            description: 'Taxonomic family', type: 'string' },
      { path: 'gbif.species',           label: 'Species',           description: 'Species epithet', type: 'string' },
      { path: 'gbif.basisOfRecord',     label: 'Basis of Record',   description: 'How the record was created: PreservedSpecimen, HumanObservation, MachineObservation, etc.', type: 'string' },
      { path: 'gbif.country',           label: 'Country',           description: 'Country of occurrence', type: 'string' },
      { path: 'gbif.institutionCode',   label: 'Institution',       description: 'Abbreviated code for contributing institution', type: 'string' },
      { path: 'gbif.occurrenceID',      label: 'Occurrence ID',     description: 'GBIF global occurrence identifier', type: 'url' },
    ],
    correspondences: [
      { field: 'decimalLatitude',    otherSource: 'ariadne', otherField: 'decimalLatitude',  relationship: 'join-candidate', notes: 'Co-locate biodiversity records with archaeological sites by coordinates' },
      { field: 'gbif.country',       otherSource: 'ariadne', otherField: 'ariadne.spatial',  relationship: 'similar',         notes: 'Both carry geographic scope but at different levels of precision' },
      { field: 'date',               otherSource: 'ariadne', otherField: 'date',             relationship: 'similar',         notes: 'GBIF date is a point observation; ARIADNE date is a coverage range' },
    ],
  },

  {
    source: 'bodleian',
    label: 'Bodleian Libraries Digital Collections',
    url: 'https://digital.bodleian.ox.ac.uk',
    coverage: 'Oxford University Bodleian Libraries digitised holdings. Manuscripts, early printed books, maps, photographs, coins, musical scores, and archival documents.',
    researchUse: 'Primary source material for manuscript studies, cartographic research, medieval and early modern history. bodleian.manifest field connects to ImageView (IIIF mode) for in-canvas manuscript browsing and region annotation.',
    limitations: 'Oxford-centric provenance. Variable metadata completeness across collection types. IIIF manifests widely available but not universal.',
    coreFields: ['title', 'description', 'date', 'creator', 'subject', 'language'],
    fields: [
      { path: 'title',                  label: 'Title',         description: 'Item title', type: 'string', mapsToCore: 'title' },
      { path: 'description',            label: 'Description',   description: 'Item description or scope notes', type: 'string', mapsToCore: 'description' },
      { path: 'date',                   label: 'Date',          description: 'Date of creation or publication', type: 'string', mapsToCore: 'date' },
      { path: 'creator',                label: 'Creator',       description: 'Author, scribe, or creator', type: 'string', mapsToCore: 'creator' },
      { path: 'subject',                label: 'Subjects',      description: 'Subject classification terms (array)', type: 'string[]', mapsToCore: 'subject' },
      { path: 'language',               label: 'Language',      description: 'Language of the item', type: 'string', mapsToCore: 'language' },
      { path: 'bodleian.manifest',      label: 'IIIF Manifest', description: 'IIIF Presentation API manifest URL — connect to ImageView (IIIF mode)', type: 'iiif', notes: 'Key field for image browsing and region annotation' },
      { path: 'bodleian.type',          label: 'Object Type',   description: 'Type of object: manuscript, map, photograph, printed book, etc.', type: 'string' },
      { path: 'bodleian.rights',        label: 'Rights',        description: 'Rights or licence statement', type: 'string' },
      { path: 'bodleian.thumbnail',     label: 'Thumbnail',     description: 'Thumbnail image URL', type: 'url' },
      { path: 'bodleian.identifier',    label: 'Identifier',    description: 'Bodleian catalogue identifier', type: 'url' },
    ],
    correspondences: [
      { field: 'title',             otherSource: 'europeana', otherField: 'title',           relationship: 'direct',         notes: 'Direct equivalent' },
      { field: 'creator',           otherSource: 'va',        otherField: 'creator',         relationship: 'direct',         notes: 'Direct equivalent — both record maker/author' },
      { field: 'bodleian.manifest', otherSource: 'smg',       otherField: 'smg.manifest',    relationship: 'direct',         notes: 'Both are IIIF Presentation API manifests — same viewer applies' },
      { field: 'bodleian.manifest', otherSource: 'va',        otherField: 'vam.manifest',    relationship: 'direct',         notes: 'Both are IIIF manifests' },
      { field: 'date',              otherSource: 'europeana', otherField: 'date',            relationship: 'similar',         notes: 'Broadly comparable but format varies by contributor' },
    ],
  },

  {
    source: 'europeana',
    label: 'Europeana',
    url: 'https://www.europeana.eu',
    coverage: 'Pan-European cultural heritage aggregator. 60M+ objects from 3,000+ cultural institutions across Europe including libraries, museums, archives, and galleries.',
    researchUse: 'Broad European cultural heritage discovery across countries and institutions. Good rights documentation (Creative Commons licence data). Use for comparative research where national scope is insufficient.',
    limitations: 'Aggregator metadata quality varies widely by contributor. Requires free API key. Full images subject to rights restrictions — thumbnails more broadly available.',
    coreFields: ['title', 'description', 'date', 'creator', 'subject', 'language'],
    fields: [
      { path: 'title',                   label: 'Title',           description: 'Item title', type: 'string', mapsToCore: 'title' },
      { path: 'description',             label: 'Description',     description: 'Item description', type: 'string', mapsToCore: 'description' },
      { path: 'date',                    label: 'Date',            description: 'Date of creation', type: 'string', mapsToCore: 'date' },
      { path: 'creator',                 label: 'Creator',         description: 'Creator or maker', type: 'string', mapsToCore: 'creator' },
      { path: 'subject',                 label: 'Subjects',        description: 'Subject terms (array)', type: 'string[]', mapsToCore: 'subject' },
      { path: 'language',                label: 'Language',        description: 'Language of the item', type: 'string', mapsToCore: 'language' },
      { path: 'europeana.type',          label: 'Media Type',      description: 'Object type: IMAGE, TEXT, VIDEO, SOUND, or 3D', type: 'string' },
      { path: 'europeana.thumbnail',     label: 'Thumbnail',       description: 'Thumbnail URL — broadly available regardless of rights', type: 'url' },
      { path: 'europeana.shownAt',       label: 'Source URL',      description: 'Link to item on the contributing institution\'s own website', type: 'url' },
      { path: 'europeana.rights',        label: 'Rights',          description: 'Rights/licence URI (e.g. CC-BY, CC0, Rights Reserved)', type: 'url', notes: 'Use for filtering openly licensed content' },
      { path: 'europeana.dataProvider',  label: 'Institution',     description: 'Original contributing institution name', type: 'string' },
      { path: 'europeana.country',       label: 'Country',         description: 'Country of the providing institution', type: 'string' },
    ],
    correspondences: [
      { field: 'title',              otherSource: 'bodleian', otherField: 'title',          relationship: 'direct',         notes: 'Direct equivalent' },
      { field: 'europeana.country',  otherSource: 'ariadne',  otherField: 'ariadne.spatial',relationship: 'similar',         notes: 'Both carry geographic scope — country vs site-level' },
      { field: 'europeana.type',     otherSource: 'bodleian', otherField: 'bodleian.type',  relationship: 'similar',         notes: 'Similar categorisation but different vocabularies' },
      { field: 'date',               otherSource: 'va',       otherField: 'date',           relationship: 'similar',         notes: 'Broadly comparable creation date' },
    ],
  },

  {
    source: 'smg',
    label: 'Science Museum Group',
    url: 'https://collection.sciencemuseumgroup.org.uk',
    coverage: 'UK national science and technology museum group. Science Museum London, Museum of Science and Industry Manchester, National Railway Museum York, National Science and Media Museum Bradford, Locomotion Shildon.',
    researchUse: 'History of science, technology, industry, and medicine. Object-level catalogue with IIIF image manifests. Connect smg.manifest to ImageView for object image browsing.',
    limitations: 'Science and technology bias — limited coverage of fine art or archaeology. Search works best with specific object names rather than broad topics. Fetch All can return large result sets.',
    coreFields: ['title', 'description', 'date', 'creator'],
    fields: [
      { path: 'title',              label: 'Title',         description: 'Object name or title', type: 'string', mapsToCore: 'title' },
      { path: 'description',        label: 'Description',   description: 'Object description', type: 'string', mapsToCore: 'description' },
      { path: 'date',               label: 'Date',          description: 'Date of manufacture or significant event', type: 'string', mapsToCore: 'date' },
      { path: 'creator',            label: 'Maker',         description: 'Maker or manufacturer', type: 'string', mapsToCore: 'creator' },
      { path: 'smg.manifest',       label: 'IIIF Manifest', description: 'IIIF Presentation API manifest URL — connect to ImageView for object browsing', type: 'iiif', notes: 'Key field for visual analysis' },
      { path: 'smg.objectType',     label: 'Object Type',   description: 'Category of object', type: 'string' },
      { path: 'smg.materials',      label: 'Materials',     description: 'Materials and techniques', type: 'string' },
      { path: 'smg.place',          label: 'Place',         description: 'Place of manufacture or origin', type: 'string' },
      { path: 'smg.museum',         label: 'Museum',        description: 'Owning museum within the SMG group', type: 'string' },
      { path: 'smg.identifier',     label: 'Identifier',    description: 'SMG collection identifier', type: 'url' },
    ],
    correspondences: [
      { field: 'smg.manifest',   otherSource: 'bodleian', otherField: 'bodleian.manifest', relationship: 'direct',       notes: 'Both are IIIF Presentation API manifests — same viewer' },
      { field: 'smg.manifest',   otherSource: 'va',       otherField: 'vam.manifest',      relationship: 'direct',       notes: 'Both are IIIF manifests' },
      { field: 'smg.place',      otherSource: 'va',       otherField: 'vam.place',         relationship: 'direct',       notes: 'Place of origin — direct equivalent' },
      { field: 'creator',        otherSource: 'va',       otherField: 'creator',           relationship: 'direct',       notes: 'Maker/manufacturer — directly comparable' },
      { field: 'smg.objectType', otherSource: 'va',       otherField: 'vam.objectType',    relationship: 'similar',       notes: 'Similar categorisation, different controlled vocabularies' },
    ],
  },

  {
    source: 'va',
    label: 'Victoria and Albert Museum',
    url: 'https://api.vam.ac.uk',
    coverage: 'V&A collection of art and design. 2.3M+ objects covering decorative arts, fashion, photography, textiles, furniture, ceramics, glass, and sculpture from worldwide cultures.',
    researchUse: 'Decorative arts and design history. Excellent image and IIIF coverage. Geographical origins of objects well documented. imagesOnly filter for visual research. Date range and object type filters available.',
    limitations: 'London and UK institutional perspective. Some objects lack precise dates or origins. imagesOnly filter substantially reduces the record count.',
    coreFields: ['title', 'description', 'date', 'creator', 'subject'],
    fields: [
      { path: 'title',            label: 'Title',         description: 'Object title or name', type: 'string', mapsToCore: 'title' },
      { path: 'description',      label: 'Description',   description: 'Object description', type: 'string', mapsToCore: 'description' },
      { path: 'date',             label: 'Date Made',     description: 'Date or period of manufacture', type: 'string', mapsToCore: 'date' },
      { path: 'creator',          label: 'Designer/Maker',description: 'Designer or maker', type: 'string', mapsToCore: 'creator' },
      { path: 'subject',          label: 'Subjects',      description: 'Subject terms (array)', type: 'string[]', mapsToCore: 'subject' },
      { path: 'vam.manifest',     label: 'IIIF Manifest', description: 'IIIF Presentation API manifest URL', type: 'iiif' },
      { path: 'vam.thumbnail',    label: 'Thumbnail',     description: 'Thumbnail image URL', type: 'url' },
      { path: 'vam.place',        label: 'Place of Origin',description: 'Place of manufacture or design', type: 'string' },
      { path: 'vam.objectType',   label: 'Object Type',   description: 'Object category (ceramics, textiles, prints, etc.)', type: 'string' },
      { path: 'vam.materials',    label: 'Materials',     description: 'Materials and techniques', type: 'string' },
      { path: 'vam.onDisplay',    label: 'On Display',    description: 'Currently on display at the V&A (boolean)', type: 'boolean' },
      { path: 'vam.rights',       label: 'Rights',        description: 'Rights statement', type: 'string' },
    ],
    correspondences: [
      { field: 'vam.manifest',   otherSource: 'bodleian', otherField: 'bodleian.manifest', relationship: 'direct',       notes: 'Both are IIIF manifests — same viewer' },
      { field: 'vam.manifest',   otherSource: 'smg',      otherField: 'smg.manifest',      relationship: 'direct',       notes: 'Both are IIIF manifests' },
      { field: 'vam.place',      otherSource: 'smg',      otherField: 'smg.place',         relationship: 'direct',       notes: 'Place of origin — directly comparable' },
      { field: 'creator',        otherSource: 'bodleian', otherField: 'creator',           relationship: 'direct',       notes: 'Direct equivalent' },
      { field: 'vam.objectType', otherSource: 'smg',      otherField: 'smg.objectType',    relationship: 'similar',       notes: 'Similar categories but different controlled vocabularies' },
    ],
  },

  {
    source: 'llds',
    label: 'Literary and Linguistic Data Service (LLDS)',
    url: 'https://llds.ling-phil.ox.ac.uk',
    coverage: 'Oxford-based literary and linguistic data collections. Digitised texts, linguistic corpora, and Oxford Text Archive holdings including TEI-XML encoded primary sources.',
    researchUse: 'Literary research, text analysis, TEI/XML primary sources. Records often include downloadable text content — good for piping through XMLExtract or KingsInference for text mining.',
    limitations: 'Entire collection loaded client-side then filtered — completeness figure reflects the filtered count, not total available. Smaller dataset than other services. 15-second timeout; cache fallback in localStorage.',
    coreFields: ['title', 'description', 'creator', 'date', 'subject', 'language'],
    fields: [
      { path: 'title',            label: 'Title',       description: 'Resource title', type: 'string', mapsToCore: 'title' },
      { path: 'description',      label: 'Description', description: 'Resource description or abstract', type: 'string', mapsToCore: 'description' },
      { path: 'creator',          label: 'Creator',     description: 'Author or creator', type: 'string', mapsToCore: 'creator' },
      { path: 'date',             label: 'Date',        description: 'Date of creation or publication', type: 'string', mapsToCore: 'date' },
      { path: 'subject',          label: 'Subjects',    description: 'Subject terms (array)', type: 'string[]', mapsToCore: 'subject' },
      { path: 'language',         label: 'Language',    description: 'Language of the text', type: 'string', mapsToCore: 'language' },
      { path: 'llds.identifier',  label: 'Identifier',  description: 'LLDS resource identifier', type: 'url' },
      { path: 'llds.type',        label: 'Type',        description: 'Resource type', type: 'string' },
      { path: 'llds.format',      label: 'Format',      description: 'File format (TEI-XML, plain text, etc.)', type: 'string' },
    ],
    correspondences: [
      { field: 'creator', otherSource: 'bodleian', otherField: 'creator', relationship: 'direct', notes: 'Author — directly comparable' },
      { field: 'language',otherSource: 'europeana', otherField: 'language',relationship: 'direct', notes: 'Language code — directly comparable' },
    ],
  },

  {
    source: 'mds',
    label: 'Museum Data Service',
    url: 'https://museumdata.uk',
    coverage: 'UK museum collections aggregator drawing from diverse regional and national museums. Broad coverage of UK museum holdings.',
    researchUse: 'UK museum collection discovery across multiple institutions in a single query. Good for breadth searches.',
    limitations: 'HTML scraper — fragile to site changes. Hard-capped at 200 records. Metadata quality and field coverage varies widely by contributing institution. Coordinates typically absent.',
    coreFields: ['title', 'description', 'date', 'creator'],
    fields: [
      { path: 'title',             label: 'Title',       description: 'Object title', type: 'string', mapsToCore: 'title' },
      { path: 'description',       label: 'Description', description: 'Object description', type: 'string', mapsToCore: 'description' },
      { path: 'creator',           label: 'Maker',       description: 'Maker or creator', type: 'string', mapsToCore: 'creator' },
      { path: 'date',              label: 'Date',        description: 'Date of object', type: 'string', mapsToCore: 'date' },
      { path: 'mds.institution',   label: 'Institution', description: 'Contributing museum', type: 'string' },
      { path: 'mds.objectType',    label: 'Object Type', description: 'Type of object', type: 'string' },
      { path: 'mds.identifier',    label: 'Identifier',  description: 'MDS record identifier', type: 'url' },
    ],
    correspondences: [
      { field: 'title',   otherSource: 'va',  otherField: 'title',  relationship: 'direct',  notes: 'Object title — direct equivalent' },
      { field: 'creator', otherSource: 'smg', otherField: 'creator',relationship: 'direct',  notes: 'Maker — direct equivalent' },
    ],
  },

  {
    source: 'framesense',
    label: 'FrameSense Video Analysis',
    url: 'https://github.com/kingsdigitallab/framesense',
    coverage: 'Pre-processed video shot analysis. One record per detected shot, produced by the FrameSense CLI (make_shots_scenedetect + make_frames_ffmpeg). Hierarchy: collection → video → clip → shot.',
    researchUse: 'Film and video archival analysis. Use KingsInference (Vision mode) for per-shot description. Use KingsInferenceByField (aggregate, field: kclResponse) for video-level summary. Filter by framesense.shotScale to target specific shot types.',
    limitations: 'Pre-processing required offline via FrameSense CLI. Folder handle lost on page refresh — must re-pick. imageDataUrl fields are large base64 strings — limit to middle frame per shot for memory efficiency. framesense.shotScale only present if scale_frames_sssabet was run during pre-processing.',
    coreFields: ['title'],
    fields: [
      { path: 'imageDataUrl',          label: 'Frame Image',    description: 'Base64 JPEG of the representative frame — auto-detected by KingsInference vision mode', type: 'string', notes: 'The primary field for vision inference' },
      { path: 'framesense.collection', label: 'Collection',     description: 'Collection name (top-level folder)', type: 'string' },
      { path: 'framesense.video',      label: 'Video',          description: 'Video name', type: 'string' },
      { path: 'framesense.clip',       label: 'Clip',           description: 'Clip name (if present in folder hierarchy)', type: 'string' },
      { path: 'framesense.shot',       label: 'Shot',           description: 'Shot number (e.g. "001")', type: 'string' },
      { path: 'framesense.frameFile',  label: 'Frame File',     description: 'Filename of the frame loaded (e.g. middle.jpg)', type: 'string' },
      { path: 'framesense.shotScale',  label: 'Shot Scale',     description: 'Shot scale classification: ECU (extreme close-up), CU, MS (medium), FS (full), LS (long)', type: 'string', notes: 'Only present if scale_frames_sssabet was run' },
    ],
    correspondences: [],
  },
]

const profileMap = new Map<string, SourceProfile>(profiles.map(p => [p.source, p]))

export function getSourceProfile(source: string): SourceProfile | undefined {
  return profileMap.get(source)
}

export function getAllProfiles(): SourceProfile[] {
  return profiles
}
