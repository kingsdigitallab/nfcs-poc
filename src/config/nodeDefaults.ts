import type { XYPosition, Node } from '@xyflow/react'
import { newId } from '../utils/nodeIdCounter'
import { DEFAULT_KCL_API_KEY, DEFAULT_EUROPEANA_API_KEY } from '../utils/kclConfig'
import type { AppNode } from '../types/AppNode'
import type { NodeTypeId } from '../nodes'
import type { LLDSSearchNodeData }        from '../nodes/LLDSSearchNode'
import type { ADSSearchAdvancedNodeData }  from '../nodes/ADSSearchAdvancedNode'
import type { ADSLibraryNodeData }         from '../nodes/ADSLibraryNode'
import type { ARIADNESearchNodeData }      from '../nodes/ARIADNESearchNode'
import type { HSDSSearchNodeData }         from '../nodes/HSDSSearchNode'
import { DEFAULT_SPARQL, type SparqlSearchNodeData } from '../nodes/SparqlSearchNode'
import type { BodleianSearchNodeData }     from '../nodes/BodleianSearchNode'
import type { SMGSearchNodeData }          from '../nodes/SMGSearchNode'
import type { VASearchNodeData }           from '../nodes/VASearchNode'
import type { GeocodingNodeData }          from '../nodes/GeocodingNode'
import type { SmartGeocoderNodeData }     from '../nodes/SmartGeocoderNode'
import type { MDSSearchNodeData }          from '../nodes/MDSSearchNode'
import type { LocalFileSourceNodeData }    from '../nodes/LocalFileSourceNode'
import type { FrameSenseSourceNodeData }   from '../nodes/FrameSenseSourceNode'
import type { SourceProfileNodeData }      from '../nodes/SourceProfileNode'
import type { LocalFolderSourceNodeData }  from '../nodes/LocalFolderSourceNode'
import type { SampleDataSourceNodeData }   from '../nodes/SampleDataSourceNode'
import type { OllamaNodeData }             from '../nodes/OllamaNode'
import type { OllamaFieldNodeData }        from '../nodes/OllamaFieldNode'
import type { KCLNodeData }               from '../nodes/KCLNode'
import type { KCLFieldNodeData }          from '../nodes/KCLFieldNode'
import type { EvaluatorNodeData }         from '../nodes/EvaluatorNode'
import type { URLFetchNodeData }           from '../nodes/URLFetchNode'
import type { HTMLSectionNodeData }        from '../nodes/HTMLSectionNode'
import type { HTMLPreviewNodeData }        from '../nodes/HTMLPreviewNode'
import type { SmartFilterNodeData }        from '../nodes/SmartFilterNode'
import type { FilterTransformNodeData }    from '../nodes/FilterTransformNode'
import type { SpatialFilterNodeData }      from '../nodes/SpatialFilterNode'
import type { DeduplicateNodeData }        from '../nodes/DeduplicateNode'
import type { ReconciliationNodeData }     from '../nodes/ReconciliationNode'
import type { ExportNodeData }             from '../nodes/ExportNode'
import type { QuickViewNodeData }          from '../nodes/QuickViewNode'
import type { QuickNoteNodeData }          from '../nodes/QuickNoteNode'
import type { ComparisonReportNodeData }   from '../nodes/ComparisonReportNode'
import type { CommentNodeData }            from '../nodes/CommentNode'
import type { MergeByQIDNodeData }         from '../nodes/MergeByQIDNode'
import type { WikidataEnrichNodeData }     from '../nodes/WikidataEnrichNode'
import type { SaveSearchNodeData }         from '../nodes/SaveSearchNode'
import type { LoadSavedSearchNodeData }   from '../nodes/LoadSavedSearchNode'
import type { XMLSectionNodeData }        from '../nodes/XMLSectionNode'
import type { ImageViewNodeData }         from '../nodes/ImageViewNode'
import type { MapOutputNodeData }          from '../nodes/MapOutputNode'
import type { TimelineOutputNodeData }     from '../nodes/TimelineOutputNode'
import type { CitationNodeData }           from '../nodes/CitationNode'
import type { EuropeanaSearchNodeData }    from '../nodes/EuropeanaSearchNode'
import type { FieldDistributionNodeData }  from '../nodes/FieldDistributionNode'
import type { QuickStartNodeData }         from '../nodes/QuickStartNode'

// ─── Node types that accept a shared KCL API key ──────────────────────────────

export const KCL_API_KEY_NODES = new Set([
  'kclNode', 'kclField', 'evaluatorNode', 'sourceProfile',
  'smartFilter', 'smartGeocoder', 'quickStart',
])

export function findSharedApiKey(nodes: Node[]): string {
  for (const node of nodes) {
    if (KCL_API_KEY_NODES.has(node.type ?? '')) {
      const key = (node.data as { apiKey?: string }).apiKey ?? ''
      if (key) return key
    }
  }
  return ''
}

// ─── Node factories ────────────────────────────────────────────────────────────

// The satisfies guard rejects factories for nonexistent node types (typos);
// Partial because a few types (e.g. proxy-only 'group' children) could in
// principle be created outside the palette. Missing palette factories are
// caught by the SIDEBAR_ITEMS ↔ NODE_DEFAULTS check in App's drop handler.
export const NODE_DEFAULTS: Record<string, (pos: XYPosition) => AppNode> = {
  param: pos => ({
    id: newId('param'), type: 'param', position: pos,
    data: { label: 'Parameter', paramType: 'Text', value: '' },
  }),
  gbifSearch: pos => ({
    id: newId('gbif'), type: 'gbifSearch', position: pos,
    data: {
      inlineQ: '', inlineScientificName: '', inlineCountry: '',
      inlineYear: '', inlineLimit: '20',
      fetchAll: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    },
  }),
  lldsSearch: pos => ({
    id: newId('llds'), type: 'lldsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      useCache: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies LLDSSearchNodeData,
  }),
  adsLibrarySearch: pos => ({
    id: newId('adslib'), type: 'adsLibrarySearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    } satisfies ADSLibraryNodeData,
  }),
  adsSearchAdvanced: pos => ({
    id: newId('ads'), type: 'adsSearchAdvanced', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '',
      sort: '_score', order: 'desc',
      useFixture: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies ADSSearchAdvancedNodeData,
  }),
  ariadneSearch: pos => ({
    id: newId('ariadne'), type: 'ariadneSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '', contributor: '',
      sort: '_score', order: 'desc',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies ARIADNESearchNodeData,
  }),
  hsdsSearch: pos => ({
    id: newId('hsds'), type: 'hsdsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      ariadneSubject: '', derivedSubject: '', nativeSubject: '',
      country: '', dataType: '', temporal: '', contributor: '',
      sort: '_score', order: 'desc',
      useFixture: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies HSDSSearchNodeData,
  }),
  bodleianSearch: pos => ({
    id: newId('bodleian'), type: 'bodleianSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      sort: 'relevance',
      fqCompleteness: '', fqOrigins: '', fqLanguages: '',
      fqMusicalNotation: '', fqDateFrom: '', fqDateTo: '',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies BodleianSearchNodeData,
  }),
  smgSearch: pos => ({
    id: newId('smg'), type: 'smgSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      museum: '', dateFrom: '', dateTo: '', searchType: 'objects',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies SMGSearchNodeData,
  }),
  vaSearch: pos => ({
    id: newId('va'), type: 'vaSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20', fetchAll: false,
      imagesOnly: false, yearFrom: '', yearTo: '', objectType: '',
      status: 'idle', statusMessage: '', count: 0,
    } satisfies VASearchNodeData,
  }),
  geocoding: pos => ({
    id: newId('geo'), type: 'geocoding', position: pos,
    data: {
      placeField: '', confidenceThreshold: 0.75,
      passNativeCoords: true, showReviewPanel: true,
      confirmedChoices: {},
      status: 'idle', statusMessage: '', resolved: 0, pending: 0, failed: 0,
    } satisfies GeocodingNodeData,
  }),
  smartGeocoder: pos => ({
    id: newId('sgeo'), type: 'smartGeocoder', position: pos,
    data: {
      apiKey:              DEFAULT_KCL_API_KEY,
      model:               'arc:lite',
      scanAllFields:       true,
      selectedFields:      [],
      confidenceThreshold: 0.6,
      passNativeCoords:    true,
      showReviewPanel:     true,
      confirmedChoices:    {},
      status:              'idle',
      statusMessage:       '',
      resolved:            0,
      pending:             0,
      failed:              0,
    } satisfies SmartGeocoderNodeData,
  }),
  mdsSearch: pos => ({
    id: newId('mds'), type: 'mdsSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      status: 'idle', statusMessage: '', results: undefined, count: 0,
      _capped: false, _total: 0,
    } satisfies MDSSearchNodeData,
  }),
  localFileSource: pos => ({
    id: newId('csvfile'), type: 'localFileSource', position: pos,
    data: {
      fileMode:      'csv',
      delimiter:     'auto',
      hasHeader:     true,
      autoCast:      true,
      pdfRenderPages: false,
      fileName:      '',
      status:        'idle',
      statusMessage: '',
      count:         0,
      columnNames:   [],
    } satisfies LocalFileSourceNodeData,
  }),
  sparqlSearch: pos => ({
    id: newId('sparql'), type: 'sparqlSearch', position: pos,
    data: {
      inlineQuery: '', inlineLimit: '20',
      sparqlQuery: DEFAULT_SPARQL,
      useFixture: false,
      status: 'idle', statusMessage: '', results: undefined, count: 0,
    } satisfies SparqlSearchNodeData,
  }),
  frameSenseSource: pos => ({
    id: newId('framesense'), type: 'frameSenseSource', position: pos,
    data: {
      folderName:      '',
      status:          'idle',
      statusMessage:   '',
      collectionCount: 0,
      videoCount:      0,
      shotCount:       0,
      frameCount:      0,
      frameFilter:     'middle',
      resultsVersion:  0,
    } satisfies FrameSenseSourceNodeData,
  }),
  sourceProfile: pos => ({
    id: newId('profile'), type: 'sourceProfile', position: pos,
    data: {
      apiKey:          DEFAULT_KCL_API_KEY,
      model:           'arc:nano',
      researchQuestion:'',
      narrative:       '',
      narrativeStatus: 'idle',
      maxTokens:       16384,
      resultsVersion:  0,
    } satisfies SourceProfileNodeData,
  }),
  localFolderSource: pos => ({
    id: newId('folder'), type: 'localFolderSource', position: pos,
    data: {
      fileTypes:     ['pdf', 'xml', 'text', 'image'],
      maxFiles:      50,
      folderName:    '',
      status:        'idle',
      statusMessage: '',
      results:       undefined,
      count:         0,
      pdfCount:      0,
      xmlCount:      0,
      textCount:     0,
      imageCount:    0,
      gisLayers:     undefined,
      gisCount:      0,
    } satisfies LocalFolderSourceNodeData,
  }),
  sampleDataSource: pos => ({
    id: newId('sample'), type: 'sampleDataSource', position: pos,
    data: {
      selectedPackage: '',
      packageTitle:    '',
      selectedFiles:   [],
      status:          'idle',
      statusMessage:   '',
      count:           0,
      pdfCount:        0,
      xmlCount:        0,
      textCount:       0,
      imageCount:      0,
      csvCount:        0,
    } satisfies SampleDataSourceNodeData,
  }),
  ollamaNode: pos => ({
    id: newId('ollama'), type: 'ollamaNode', position: pos,
    data: {
      model:               '',
      visionOverride:      false,
      systemPrompt:        'You are a research assistant helping to analyse humanities research documents and data.',
      userPromptTemplate:  'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}',
      temperature:         0.7,
      maxTokens:           4096,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies OllamaNodeData,
  }),
  ollamaField: pos => ({
    id: newId('ollamaField'), type: 'ollamaField', position: pos,
    data: {
      model:               '',
      selectedField:       '',
      mode:                'per-record',
      systemPrompt:        'You are a research assistant helping to analyse humanities research data.',
      userPromptTemplate:  'Summarise the following in 2–3 sentences:\n\n{{value}}',
      temperature:         0.7,
      maxTokens:           4096,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies OllamaFieldNodeData,
  }),
  kclNode: pos => ({
    id: newId('kcl'), type: 'kclNode', position: pos,
    data: {
      apiKey:              DEFAULT_KCL_API_KEY,
      model:               'arc:nano',
      systemPrompt:        'You are a research assistant helping to analyse humanities research documents and data.',
      userPromptTemplate:  'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}',
      temperature:         0.7,
      maxTokens:           32768,
      visionMode:          false,
      imageField:          '',
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies KCLNodeData,
  }),
  kclField: pos => ({
    id: newId('kclField'), type: 'kclField', position: pos,
    style: { width: 300 },
    data: {
      apiKey:              DEFAULT_KCL_API_KEY,
      model:               'arc:nano',
      selectedField:       '',
      outputField:         '',
      mode:                'per-record',
      systemPrompt:        'You are a research assistant helping to analyse humanities research data.',
      userPromptTemplate:  'Summarise the following in 2–3 sentences:\n\n{{value}}',
      temperature:         0.7,
      maxTokens:           32768,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      inputCount:          0,
      outputCount:         0,
    } satisfies KCLFieldNodeData,
  }),
  evaluatorNode: pos => ({
    id: newId('evaluator'), type: 'evaluatorNode', position: pos,
    style: { width: 300 },
    data: {
      apiKey:          DEFAULT_KCL_API_KEY,
      judgeModel:      'arc:nexus',
      referenceField:  '',
      candidateField:  '',
      rubricPrompt:    '',
      recipePreset:    'interpretive-agreement',
      humanScoreField: '',
      temperature:     0,
      maxTokens:       32768,
      status:          'idle',
      statusMessage:   '',
      results:         undefined,
      inputCount:      0,
      outputCount:     0,
      scoredCount:     0,
      skippedCount:    0,
      parseErrCount:   0,
      resultsVersion:  0,
      elapsedMs:       0,
    } satisfies EvaluatorNodeData,
  }),
  kclOutput: pos => ({
    id: newId('kclOut'), type: 'kclOutput', position: pos,
    data: {},
  }),
  urlFetch: pos => ({
    id: newId('urlFetch'), type: 'urlFetch', position: pos,
    data: {
      urlField:      '_sourceUrl',
      stripHtml:     true,
      maxLength:     8000,
      timeoutSecs:   10,
      renderJs:      true,
      waitStrategy:  'networkidle2',
      status:        'idle',
      statusMessage: '',
      results:       undefined,
      inputCount:    0,
      outputCount:   0,
    } satisfies URLFetchNodeData,
  }),
  htmlSection: pos => ({
    id: newId('htmlSection'), type: 'htmlSection', position: pos,
    data: {
      selector:        'main, article',
      separator:       '\n\n',
      maxLength:       8000,
      preserveHtml:    false,
      extractSection:  false,
      status:          'idle',
      statusMessage:   '',
      inputCount:      0,
      outputCount:     0,
    } satisfies HTMLSectionNodeData,
  }),
  htmlPreview: pos => ({
    id: newId('htmlPreview'), type: 'htmlPreview', position: pos,
    style: { width: 460, height: 540 },
    data: {
      mode:     'captured',
      urlField: '_sourceUrl',
    } satisfies HTMLPreviewNodeData,
  }),
  smartFilter: pos => ({
    id: newId('smartFilter'), type: 'smartFilter', position: pos,
    data: {
      apiKey:          DEFAULT_KCL_API_KEY,
      model:           'arc:nano',
      nlQuery:         '',
      generatedFilter:    null,
      disabledConditions: [],
      filterStatus:       'idle',
      filterMessage:      '',
      matchCount:         0,
      totalCount:         0,
      resultsVersion:     0,
    } satisfies SmartFilterNodeData,
  }),
  filterTransform: pos => ({
    id: newId('ft'), type: 'filterTransform', position: pos,
    data: {
      mode:             'filter',
      filterCombinator: 'AND',
      filterOps:        [],
      transformOps:     [],
      status:           'idle',
      statusMessage:    '',
      results:          undefined,
      inputCount:       0,
      outputCount:      0,
    } satisfies FilterTransformNodeData,
  }),
  spatialFilter: pos => ({
    id: newId('sf'), type: 'spatialFilter', position: pos,
    data: {
      bbox:           null,
      status:         'idle',
      statusMessage:  '',
      results:        undefined,
      inputCount:     0,
      outputCount:    0,
    } satisfies SpatialFilterNodeData,
  }),
  deduplicate: pos => ({
    id: newId('dedup'), type: 'deduplicate', position: pos,
    data: {
      dedupeField:   'id',
      status:        'idle',
      statusMessage: '',
      inputCount:    0,
      outputCount:   0,
      removedCount:  0,
    } satisfies DeduplicateNodeData,
  }),
  reconciliation: pos => ({
    id: newId('recon'), type: 'reconciliation', position: pos,
    data: {
      selectedField:       '',
      selectedAuthority:   '',
      confidenceThreshold: 0.8,
      status:              'idle',
      statusMessage:       '',
      results:             undefined,
      count:               0,
      resolvedCount:       0,
      reviewCount:         0,
    } satisfies ReconciliationNodeData,
  }),
  export: pos => ({
    id: newId('export'), type: 'export', position: pos,
    data: { format: 'csv' } satisfies ExportNodeData,
  }),
  quickView: pos => ({
    id: newId('quickView'), type: 'quickView', position: pos,
    data: { selectedField: '' } satisfies QuickViewNodeData,
  }),
  quickNote: pos => ({
    id: newId('quickNote'), type: 'quickNote', position: pos,
    data: { selectedField: '' } satisfies QuickNoteNodeData,
    style: { width: 340 },
  }),
  comparisonReport: pos => ({
    id: newId('cmpreport'), type: 'comparisonReport', position: pos,
    data: {
      originalField: '', noteField: '', responseField: '',
      judgeScoreField: '', humanScoreField: '',
    } satisfies ComparisonReportNodeData,
    style: { width: 520, height: 600 },
  }),
  comment: pos => ({
    id: newId('comment'), type: 'comment', position: pos,
    data: { title: '', body: '' } satisfies CommentNodeData,
    style: { width: 220, height: 120 },
  }),
  mergeByQID: pos => ({
    id: newId('merge'), type: 'mergeByQID', position: pos,
    data: {
      keepUnmatched:  false,
      status:         'idle',
      statusMessage:  '',
      mergedCount:    0,
      unmatchedCount: 0,
      resultsVersion: 0,
    } satisfies MergeByQIDNodeData,
  }),
  wikidataEnrich: pos => ({
    id: newId('wdenrich'), type: 'wikidataEnrich', position: pos,
    data: {
      reconcileField:     '',
      selectedProperties: [],
      customProperties:   '',
      status:             'idle',
      statusMessage:      '',
      count:              0,
      resultsVersion:     0,
    } satisfies WikidataEnrichNodeData,
  }),
  saveSearch: pos => ({
    id: newId('save'), type: 'saveSearch', position: pos,
    data: {
      status:        'idle',
      statusMessage: '',
      lastSavedFile: '',
      lastSavedAt:   '',
    } satisfies SaveSearchNodeData,
  }),
  loadSavedSearch: pos => ({
    id: newId('load'), type: 'loadSavedSearch', position: pos,
    data: {
      status:        'idle',
      statusMessage: '',
      savedAt:       '',
      sources:       [],
      sourceCounts:  {},
      recordCount:   0,
      searchParams:  {},
      hasEnvelope:   false,
      count:         0,
      resultsVersion: 0,
    } satisfies LoadSavedSearchNodeData,
  }),
  xmlSection: pos => ({
    id: newId('xml'), type: 'xmlSection', position: pos,
    style: { width: 320, height: 370 },
    data: {
      xpath:         '',
      outputMode:    'text',
      maxLength:     8000,
      status:        'idle',
      statusMessage: '',
      inputCount:    0,
      outputCount:   0,
    } satisfies XMLSectionNodeData,
  }),
  imageView: pos => ({
    id: newId('imgview'), type: 'imageView', position: pos,
    data: {
      mode: 'iiif',
      selectedField: '',
      imageDirectUrl: '',
      manifestUrl: '',
    } satisfies ImageViewNodeData,
    style: { width: 400, height: 480 },
  }),
  tableOutput: pos => ({
    id: newId('table'), type: 'tableOutput', position: pos,
    style: { width: 560, height: 380 },
    data: {},
  }),
  jsonOutput: pos => ({
    id: newId('json'), type: 'jsonOutput', position: pos,
    data: {},
  }),
  mapOutput: pos => ({
    id: newId('map'), type: 'mapOutput', position: pos,
    data: {
      bbox:           null,
      inputCount:     0,
      outputCount:    0,
      resultsVersion: 0,
    } satisfies MapOutputNodeData,
  }),
  timelineOutput: pos => ({
    id: newId('timeline'), type: 'timelineOutput', position: pos,
    data: { fitToRange: false, filterStart: null, filterEnd: null } satisfies TimelineOutputNodeData,
    style: { width: 520 },
  }),
  timelineView: pos => ({
    id: newId('timeline'), type: 'timelineView', position: pos,
    data: { fitToRange: false, filterStart: null, filterEnd: null } satisfies TimelineOutputNodeData,
    style: { width: 520 },
  }),
  ollamaOutput: pos => ({
    id: newId('ollamaOut'), type: 'ollamaOutput', position: pos,
    data: {},
  }),
  citation: pos => ({
    id: newId('citation'), type: 'citation', position: pos,
    data: {} satisfies CitationNodeData,
  }),
  europeanaSearch: pos => ({
    id: newId('europeana'), type: 'europeanaSearch', position: pos,
    data: {
      apiKey: DEFAULT_EUROPEANA_API_KEY, inlineQuery: '', inlineLimit: '20',
      typeFilter: 'any', reusability: 'any', mediaOnly: false,
      status: 'idle', statusMessage: '', count: 0,
    } satisfies EuropeanaSearchNodeData,
  }),
  fieldDistribution: pos => ({
    id: newId('fdist'), type: 'fieldDistribution', position: pos,
    data: { selectedField: '', maxBars: 20, expandArrays: true, filteredValues: [] } satisfies FieldDistributionNodeData,
  }),
  quickStart: pos => ({
    id: newId('qs'), type: 'quickStart', position: pos,
    data: {
      apiKey: DEFAULT_KCL_API_KEY, model: 'arc:nexus',
      researchQuestion: '', plan: null,
      planStatus: 'idle', planMessage: '', instantiated: false,
    } satisfies QuickStartNodeData,
  }),
  group: pos => ({
    id: newId('group'), type: 'group', position: pos,
    style: { width: 400, height: 300 },
    data: { name: 'Group' },
  }),
} satisfies Partial<Record<NodeTypeId, (pos: XYPosition) => AppNode>>
