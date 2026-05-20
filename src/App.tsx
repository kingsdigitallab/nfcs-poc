import { useCallback, useEffect, useRef, useState } from 'react'
import { newId, bumpCounterPast } from './utils/nodeIdCounter'
import { DEFAULT_KCL_API_KEY, DEFAULT_EUROPEANA_API_KEY } from './utils/kclConfig'
import { downloadWorkflow, parseWorkflowFile, hydrateNodes } from './utils/workflowIO'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type XYPosition,
  type ReactFlowInstance,
  type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { nodeTypes } from './nodes'
import { ExpandedOutputPanel } from './nodes/ExpandedOutputPanel'
import { ChatSidebar } from './components/ChatSidebar'
import { ConnectionSuggestions, HandlePicker, NODE_PARAM_HANDLES, type Suggestion } from './components/ConnectionSuggestions'

/**
 * Handle ids that must only ever carry ONE inbound connection. These are the
 * scalar param-style inputs (query strings, limits, API keys) where two
 * sources would race/overwrite each other. Plural inputs like `data` are
 * intentionally excluded — they are designed to merge multiple upstreams.
 *
 * The set is derived from NODE_PARAM_HANDLES (every handle listed there is a
 * single-value param input) plus the always-singular `apiKey` which can
 * appear on additional node types in future.
 */
const SINGLETON_TARGET_HANDLES = new Set<string>([
  'apiKey',
  ...Object.values(NODE_PARAM_HANDLES).flatMap(hs => hs.map(h => h.id)),
])
import { runWorkflow } from './utils/runWorkflow'
import { invokeToggle } from './utils/groupToggleRegistry'
import type { UnifiedRecord } from './types/UnifiedRecord'
import type { LocalFolderSourceNodeData } from './nodes/LocalFolderSourceNode'
import type { LocalFileSourceNodeData }   from './nodes/LocalFileSourceNode'
import type { OllamaNodeData }            from './nodes/OllamaNode'
import type { OllamaFieldNodeData }       from './nodes/OllamaFieldNode'
import type { KCLNodeData }              from './nodes/KCLNode'
import type { KCLFieldNodeData }         from './nodes/KCLFieldNode'
import type { HTMLPreviewNodeData }      from './nodes/HTMLPreviewNode'
import type { URLFetchNodeData }          from './nodes/URLFetchNode'
import type { HTMLSectionNodeData }       from './nodes/HTMLSectionNode'
import type { LLDSSearchNodeData }        from './nodes/LLDSSearchNode'
import type { ADSSearchAdvancedNodeData }     from './nodes/ADSSearchAdvancedNode'
import type { ADSLibraryNodeData }            from './nodes/ADSLibraryNode'
import type { MDSSearchNodeData }         from './nodes/MDSSearchNode'
import type { ReconciliationNodeData }    from './nodes/ReconciliationNode'
import type { FilterTransformNodeData }   from './nodes/FilterTransformNode'
import type { SpatialFilterNodeData }     from './nodes/SpatialFilterNode'
import type { DeduplicateNodeData }       from './nodes/DeduplicateNode'
import type { ExportNodeData }            from './nodes/ExportNode'
import type { QuickViewNodeData }         from './nodes/QuickViewNode'
import type { CommentNodeData }           from './nodes/CommentNode'
import type { MergeByQIDNodeData }        from './nodes/MergeByQIDNode'
import type { WikidataEnrichNodeData }    from './nodes/WikidataEnrichNode'
import type { SaveSearchNodeData }        from './nodes/SaveSearchNode'
import type { LoadSavedSearchNodeData }  from './nodes/LoadSavedSearchNode'
import type { XMLSectionNodeData }       from './nodes/XMLSectionNode'
import type { ImageViewNodeData }        from './nodes/ImageViewNode'
import type { CitationNodeData }           from './nodes/CitationNode'
import type { EuropeanaSearchNodeData }    from './nodes/EuropeanaSearchNode'
import type { ARIADNESearchNodeData }      from './nodes/ARIADNESearchNode'
import type { HSDSSearchNodeData }         from './nodes/HSDSSearchNode'
import type { BodleianSearchNodeData }     from './nodes/BodleianSearchNode'
import type { FieldDistributionNodeData }  from './nodes/FieldDistributionNode'
import type { TimelineOutputNodeData }     from './nodes/TimelineOutputNode'
import type { MapOutputNodeData }          from './nodes/MapOutputNode'
import type { SMGSearchNodeData }          from './nodes/SMGSearchNode'
import type { VASearchNodeData }           from './nodes/VASearchNode'
import type { GeocodingNodeData }          from './nodes/GeocodingNode'
import type { FrameSenseSourceNodeData }  from './nodes/FrameSenseSourceNode'
import type { SourceProfileNodeData }    from './nodes/SourceProfileNode'
import type { SmartFilterNodeData }      from './nodes/SmartFilterNode'
import type { SmartGeocoderNodeData }   from './nodes/SmartGeocoderNode'
import type { QuickStartNodeData }      from './nodes/QuickStartNode'
import type { GroupNodeData }           from './nodes/GroupNode'

// ─── node data types (kept slim here; full types live in each node file) ─────

interface ParamNodeData  { label: string; paramType: string; value: string; [k: string]: unknown }
interface SearchNodeData { status: string; statusMessage: string; results?: UnifiedRecord[]; count?: number; [k: string]: unknown }
interface OutputNodeData { [k: string]: unknown }

type AppNode =
  | Node<ParamNodeData>
  | Node<SearchNodeData>
  | Node<LocalFolderSourceNodeData>
  | Node<LocalFileSourceNodeData>
  | Node<OllamaNodeData>
  | Node<OllamaFieldNodeData>
  | Node<KCLNodeData>
  | Node<KCLFieldNodeData>
  | Node<HTMLPreviewNodeData>
  | Node<URLFetchNodeData>
  | Node<HTMLSectionNodeData>
  | Node<LLDSSearchNodeData>
  | Node<ADSSearchAdvancedNodeData>
  | Node<ADSLibraryNodeData>
  | Node<MDSSearchNodeData>
  | Node<ReconciliationNodeData>
  | Node<FilterTransformNodeData>
  | Node<SpatialFilterNodeData>
  | Node<DeduplicateNodeData>
  | Node<ExportNodeData>
  | Node<QuickViewNodeData>
  | Node<CommentNodeData>
  | Node<MergeByQIDNodeData>
  | Node<WikidataEnrichNodeData>
  | Node<SaveSearchNodeData>
  | Node<LoadSavedSearchNodeData>
  | Node<XMLSectionNodeData>
  | Node<ImageViewNodeData>
  | Node<CitationNodeData>
  | Node<EuropeanaSearchNodeData>
  | Node<ARIADNESearchNodeData>
  | Node<HSDSSearchNodeData>
  | Node<BodleianSearchNodeData>
  | Node<FieldDistributionNodeData>
  | Node<TimelineOutputNodeData>
  | Node<MapOutputNodeData>
  | Node<SMGSearchNodeData>
  | Node<VASearchNodeData>
  | Node<GeocodingNodeData>
  | Node<FrameSenseSourceNodeData>
  | Node<SourceProfileNodeData>
  | Node<SmartFilterNodeData>
  | Node<SmartGeocoderNodeData>
  | Node<QuickStartNodeData>
  | Node<GroupNodeData>
  | Node<OutputNodeData>

// ─── node factories ───────────────────────────────────────────────────────────

const KCL_API_KEY_NODES = new Set(['kclNode', 'kclField', 'sourceProfile', 'smartFilter', 'smartGeocoder', 'quickStart'])

function findSharedApiKey(nodes: Node[]): string {
  for (const node of nodes) {
    if (KCL_API_KEY_NODES.has(node.type ?? '')) {
      const key = (node.data as { apiKey?: string }).apiKey ?? ''
      if (key) return key
    }
  }
  return ''
}

const NODE_DEFAULTS: Record<string, (pos: XYPosition) => AppNode> = {
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
      useCache: true,
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
      fileName:      '',
      status:        'idle',
      statusMessage: '',
      count:         0,
      columnNames:   [],
    } satisfies LocalFileSourceNodeData,
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
  ollamaNode: pos => ({
    id: newId('ollama'), type: 'ollamaNode', position: pos,
    data: {
      model:               '',
      visionOverride:      false,
      systemPrompt:        'You are a research assistant helping to analyse humanities research documents and data.',
      userPromptTemplate:  'Summarise the key themes and subjects in 3-4 sentences:\n\n{{content}}',
      temperature:         0.7,
      maxTokens:           1024,
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
      maxTokens:           1024,
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
    data: {
      apiKey:              DEFAULT_KCL_API_KEY,
      model:               'arc:nano',
      selectedField:       '',
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
    data: { fitToRange: false } satisfies TimelineOutputNodeData,
    style: { width: 520 },
  }),
  timelineView: pos => ({
    id: newId('timeline'), type: 'timelineView', position: pos,
    data: { fitToRange: false } satisfies TimelineOutputNodeData,
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
}

// ─── sidebar definition ───────────────────────────────────────────────────────

const SIDEBAR_ITEMS = [
  // ── Canvas ──────────────────────────────────────────────────────────────────
  { type: 'quickStart',  label: 'QuickStart',        sub: 'AI workflow planner — describe a question, auto-build a workflow', color: '#0c1445', group: 'Canvas' },
  { type: 'comment',     label: 'Comment',           sub: 'Annotation label',          color: '#f59e0b', group: 'Canvas' },
  // ── Input ───────────────────────────────────────────────────────────────────
  { type: 'param',       label: 'Param',             sub: 'Text / Integer value',      color: '#3b82f6', group: 'Input' },
  // ── Inspection ───────────────────────────────────────────────────────────────
  { type: 'quickView',         label: 'QuickView',             sub: 'Inspect one field in full',               color: '#1e293b', group: 'Inspection' },
  { type: 'imageView',         label: 'ImageView',             sub: 'Image + IIIF manifest viewer',            color: '#1c3144', group: 'Inspection' },
  { type: 'htmlPreview',       label: 'HTMLPreview',           sub: 'Browse captured HTML, click to capture CSS selectors', color: '#0c4a6e', group: 'Inspection' },
  { type: 'sourceProfile',     label: 'SourceProfile',         sub: 'Schema, field stats, completeness + AI narrative', color: '#1f2937', group: 'Inspection' },
  // ── Data Services ────────────────────────────────────────────────────────────
  { type: 'ariadneSearch',     label: 'ARIADNESearch',         sub: 'ARIADNE pan-European archaeology portal',  color: '#164e63', group: 'Data Services' },
  { type: 'hsdsSearch',        label: 'HSDSSearch',            sub: 'Heritage Science Data Service',        color: '#134e4a', group: 'Data Services' },
  { type: 'bodleianSearch',   label: 'BodleianSearch',        sub: 'Bodleian Digital Collections (Oxford)',    color: '#003865', group: 'Data Services' },
  { type: 'europeanaSearch',   label: 'EuropeanaSearch',       sub: 'Europeana cultural heritage aggregator',  color: '#2563eb', group: 'Data Services' },
  { type: 'gbifSearch',        label: 'GBIFSearch',            sub: 'GBIF occurrence search',                  color: '#0f4c81', group: 'Data Services' },
  { type: 'lldsSearch',        label: 'LLDSSearch',            sub: 'Lit. & Linguistic Data',                  color: '#92400e', group: 'Data Services' },
  { type: 'mdsSearch',         label: 'MDSSearch',             sub: 'Museum Data Services',                     color: '#1e3a8a', group: 'Data Services' },
  { type: 'smgSearch',         label: 'SMGSearch',             sub: 'Science Museum Group collections',         color: '#701a75', group: 'Data Services' },
  { type: 'vaSearch',          label: 'VASearch',              sub: 'Victoria and Albert Museum collections',    color: '#9f1239', group: 'Data Services' },
  { type: 'geocoding',         label: 'Geocoding',             sub: 'TGN + Wikidata place enrichment',                   color: '#065f46', group: 'Extraction and Enrichment' },
  { type: 'smartGeocoder',    label: 'SmartGeocoder',         sub: 'LLM place extraction → Nominatim + TGN + Wikidata',  color: '#1e3a5f', group: 'Extraction and Enrichment' },
  // ── Local Content ────────────────────────────────────────────────────────────
  { type: 'frameSenseSource',  label: 'FrameSenseSource',      sub: 'Load pre-processed FrameSense video shots', color: '#1c2a3a', group: 'Local Content' },
  { type: 'localFileSource',   label: 'LocalFileSource',       sub: 'Single CSV, XML, image or PDF file',           color: '#0e7490', group: 'Local Content' },
  { type: 'localFolderSource', label: 'LocalFolderSource',     sub: 'Read files from local folder',            color: '#14532d', group: 'Local Content' },
  { type: 'loadSavedSearch',   label: 'LoadSavedSearch',       sub: 'Replay a .nfcs.json saved search',        color: '#4c1d95', group: 'Local Content' },
  { type: 'saveSearch',        label: 'SaveSearch',            sub: 'Save records + metadata to .nfcs.json',   color: '#1b4332', group: 'Local Content' },
  // ── Filters and Transforms ───────────────────────────────────────────────────
  { type: 'fieldDistribution', label: 'FieldDistribution',     sub: 'Faceted bar chart — click bars to filter', color: '#047857', group: 'Filters and Transforms' },
  { type: 'smartFilter',       label: 'SmartFilter',           sub: 'Natural language → filter records',         color: '#0f4c81', group: 'Filters and Transforms' },
  { type: 'filterTransform',   label: 'FilterTransform',       sub: 'Filter + transform records',               color: '#4f46e5', group: 'Filters and Transforms' },
  { type: 'spatialFilter',     label: 'SpatialFilter',         sub: 'Draw bounding box to filter by location',  color: '#0891b2', group: 'Filters and Transforms' },
  { type: 'deduplicate',       label: 'Deduplicate',           sub: 'Remove duplicate records by field value',  color: '#0f766e', group: 'Filters and Transforms' },
  // ── Extraction and Enrichment ────────────────────────────────────────────────
  { type: 'kclNode',           label: 'KingsInference',        sub: 'KCL inference — file/content records',    color: '#881337', group: 'Extraction and Enrichment' },
  { type: 'kclField',          label: 'KingsInferenceByField', sub: 'KCL inference on a chosen field',         color: '#7f1d1d', group: 'Extraction and Enrichment' },
  { type: 'urlFetch',          label: 'URLContentFetch',       sub: 'Fetch URL content into records',          color: '#0c4a6e', group: 'Extraction and Enrichment' },
  { type: 'htmlSection',       label: 'HTMLExtract',           sub: 'Extract page section by CSS selector',    color: '#065f46', group: 'Extraction and Enrichment' },
  { type: 'reconciliation',    label: 'Reconciliation',        sub: 'Wikidata field reconciler',               color: '#7c3aed', group: 'Extraction and Enrichment' },
  { type: 'wikidataEnrich',    label: 'WikidataEnrich',        sub: 'Fetch Wikidata properties for QIDs',      color: '#0369a1', group: 'Extraction and Enrichment' },
  { type: 'mergeByQID',        label: 'MergeByQID',            sub: 'Join records from multiple sources by QID', color: '#6b21a8', group: 'Extraction and Enrichment' },
  { type: 'xmlSection',        label: 'XMLExtract',            sub: 'Extract XML content by XPath',            color: '#44403c', group: 'Extraction and Enrichment' },
  // ── Output ───────────────────────────────────────────────────────────────────
  { type: 'citation',          label: 'Citation',              sub: 'Data source citations for this workflow stage', color: '#78350f', group: 'Output' },
  { type: 'export',            label: 'Export',                sub: 'CSV / JSON / GeoJSON',                    color: '#b45309', group: 'Output' },
  { type: 'jsonOutput',        label: 'JSONOutput',            sub: 'Formatted JSON viewer',                   color: '#6d28d9', group: 'Output' },
  { type: 'kclOutput',         label: 'KingsInferenceOutput',  sub: 'Display KCL inference text',              color: '#3b0764', group: 'Output' },
  { type: 'mapOutput',         label: 'MapOutput',             sub: 'Geo map (lat/lon records)',                color: '#14532d', group: 'Inspection' },
  { type: 'tableOutput',       label: 'TableOutput',           sub: 'Paginated results table',                 color: '#0d9488', group: 'Inspection' },
  { type: 'timelineView',      label: 'TimelineView',          sub: 'Filter records by date range + timeline',  color: '#1e293b', group: 'Inspection' },
  // ── Hidden ───────────────────────────────────────────────────────────────────
  { type: 'adsLibrarySearch',  label: 'ADSLibrary',            sub: 'ADS Library catalogue',                   color: '#1e3a5f', group: 'Output', hidden: true },
  { type: 'adsSearchAdvanced', label: 'ADSSearch',             sub: 'Archaeology Data Services',                color: '#7c2d12', group: 'Output', hidden: true },
  { type: 'ollamaNode',        label: 'Ollama',                sub: 'Local LLM — file/content records',        color: '#312e81', group: 'Output', hidden: true },
  { type: 'ollamaField',       label: 'OllamaByField',         sub: 'LLM inference on a chosen field',        color: '#1e1b4b', group: 'Output', hidden: true },
  { type: 'ollamaOutput',      label: 'OllamaOutput',          sub: 'Display Ollama inference text',           color: '#0f172a', group: 'Output', hidden: true },
]

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set(['Data Services', 'Local Content', 'Filters and Transforms', 'Extraction and Enrichment', 'Output']))
  const [chatOpen, setChatOpen] = useState(true)

  const [connMenu, setConnMenu] = useState<{
    x: number; y: number
    sourceNodeId: string; sourceNodeType: string; sourceHandleId: string | null
  } | null>(null)

  // Second-step handle picker (for param → multi-handle nodes)
  const [handlePicker, setHandlePicker] = useState<{
    x: number; y: number
    pendingNodeType: string; pendingColor: string
    sourceNodeId: string; sourceHandleId: string | null
  } | null>(null)

  // Auto-resize groups to fit children. Bidirectional (grows AND shrinks) so
  // that no stale dimensions linger across collapse/expand cycles. The previous
  // grow-only behaviour meant a group resized larger by NodeResizer would stay
  // large after expand, and the next collapse would briefly draw the old big
  // outline before the pill size took effect.
  // A 4px tolerance prevents setNodes/measured-resync feedback loops.
  useEffect(() => {
    const groups = nodes.filter(n => n.type === 'group')
    if (groups.length === 0) return

    const TOLERANCE = 4
    const updated = nodes.map(node => {
      if (node.type !== 'group') return node
      if ((node.data as any).collapsed) return node

      const children = nodes.filter(n => n.parentId === node.id)
      if (children.length === 0) return node

      let maxX = 0, maxY = 0
      for (const child of children) {
        const cw = Number(child.measured?.width ?? (child as any).style?.width ?? 220)
        const ch = Number(child.measured?.height ?? (child as any).style?.height ?? 100)
        maxX = Math.max(maxX, child.position.x + cw)
        maxY = Math.max(maxY, child.position.y + ch)
      }

      const padding = 30
      const targetW = Math.max(250, maxX + padding)
      const targetH = Math.max(120, maxY + padding)
      const currentW = Number((node as any).style?.width ?? 0)
      const currentH = Number((node as any).style?.height ?? 0)

      if (Math.abs(targetW - currentW) <= TOLERANCE && Math.abs(targetH - currentH) <= TOLERANCE) {
        return node
      }
      return {
        ...node,
        width: targetW,
        height: targetH,
        style: {
          ...((node as any).style ?? {}),
          width: targetW,
          height: targetH,
        },
      } as AppNode
    })

    const changed = updated.some((n, i) => n !== nodes[i])
    if (changed) setNodes(updated)
  }, [nodes, setNodes])

  const handleRunAll = useCallback(async () => {
    if (!rfInstance) return
    setRunningAll(true)
    await runWorkflow(rfInstance.getNodes, rfInstance.getEdges(), rfInstance.updateNodeData)
    setRunningAll(false)
  }, [rfInstance])

  const handleGroupSelected = useCallback(() => {
    if (!rfInstance) return
    const currentNodes = rfInstance.getNodes()
    const selected = currentNodes.filter(n => n.selected && n.type !== 'group')
    if (selected.length < 2) return

    // Calculate bounding box with padding
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of selected) {
      const w = (n as Node & { style?: { width?: number; height?: number } }).style?.width ?? 200
      const h = (n as Node & { style?: { width?: number; height?: number } }).style?.height ?? 100
      minX = Math.min(minX, n.position.x)
      minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + w)
      maxY = Math.max(maxY, n.position.y + h)
    }
    const padding = 20
    const headerH = 35
    const width  = maxX - minX + padding * 2
    const height = maxY - minY + padding * 2 + headerH
    const groupPos = { x: minX - padding, y: minY - padding - headerH }

    // Count existing groups for naming
    const existingNames = new Set(
      currentNodes.filter(n => n.type === 'group').map(n => (n.data as { name?: string }).name ?? '')
    )
    let groupNumber = 1
    while (existingNames.has(`Group ${groupNumber}`)) {
      groupNumber++
    }
    const groupName = `Group ${groupNumber}`

    const groupNode = {
      id: newId('group'),
      type: 'group',
      position: groupPos,
      style: { width, height },
      data: { name: groupName },
      selected: true,
    } as AppNode

    const updatedNodes = currentNodes.map(n => {
      if (!n.selected || n.type === 'group') return n
      return {
        ...n,
        parentId: groupNode.id,
        position: {
          x: n.position.x - groupPos.x,
          y: n.position.y - groupPos.y,
        },
        extent: 'parent' as const,
        selected: false,
      }
    })

    // Parent must precede children in the array so React Flow resolves
    // the parentId reference before rendering children.
    setNodes([groupNode, ...updatedNodes])
  }, [rfInstance, setNodes])

  const handleUngroup = useCallback(() => {
    if (!rfInstance) return
    const currentNodes = rfInstance.getNodes()
    const selectedGroup = currentNodes.find(n => n.selected && n.type === 'group')
    if (!selectedGroup) return

    // Refuse to ungroup while collapsed — edges still point at proxy handles and
    // would become orphaned when the group node is deleted.
    if ((selectedGroup.data as any).collapsed) {
      invokeToggle(selectedGroup.id)
      return
    }

    const groupPos = selectedGroup.position
    const updatedNodes = currentNodes.map(n => {
      if (n.parentId !== selectedGroup.id) return n
      return {
        ...n,
        parentId: undefined,
        extent: undefined,
        position: {
          x: n.position.x + groupPos.x,
          y: n.position.y + groupPos.y,
        },
      }
    })

    setNodes(updatedNodes.filter(n => n.id !== selectedGroup.id))
  }, [rfInstance, setNodes])

  const handleSave = useCallback(() => {
    downloadWorkflow(nodes, edges)
  }, [nodes, edges])

  const handleLoadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-loaded if needed
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wf = parseWorkflowFile(ev.target?.result as string)
        const hydrated = hydrateNodes(wf)
        bumpCounterPast(hydrated.map(n => n.id))
        setNodes(hydrated)
        // Strip edges that reference proxy handles of expanded groups — these are
        // stale refs left by incomplete collapse/expand cycles in a prior session.
        const expandedGroupIds = new Set(
          hydrated
            .filter(n => n.type === 'group' && !(n.data as any).collapsed)
            .map(n => n.id),
        )
        setEdges(
          wf.edges.filter(
            ed =>
              !(ed.sourceHandle?.startsWith('proxy-out-') && expandedGroupIds.has(ed.source)) &&
              !(ed.targetHandle?.startsWith('proxy-in-') && expandedGroupIds.has(ed.target)),
          ),
        )
        setLoadError(null)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load workflow.')
      }
    }
    reader.readAsText(file)
  }, [setNodes, setEdges])

  const onConnect = useCallback(
    (connection: Connection) => setEdges(eds => {
      // Singleton enforcement: if the target handle accepts only one inbound
      // edge, drop any existing edge to (target, targetHandle) before adding.
      const th = connection.targetHandle
      const needsReplace =
        th != null &&
        SINGLETON_TARGET_HANDLES.has(th) &&
        eds.some(e => e.target === connection.target && e.targetHandle === th)
      const base = needsReplace
        ? eds.filter(e => !(e.target === connection.target && e.targetHandle === th))
        : eds
      return addEdge(connection, base)
    }),
    [setEdges],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      if (!reactFlowWrapper.current || !rfInstance) return

      const nodeType = event.dataTransfer.getData('application/reactflow')
      const factory = NODE_DEFAULTS[nodeType]
      if (!factory) return

      const bounds = reactFlowWrapper.current.getBoundingClientRect()
      const position = rfInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      })
      setNodes(nds => {
        const newNode = factory(position) as AppNode
        if (KCL_API_KEY_NODES.has(nodeType) && !(newNode.data as { apiKey?: string }).apiKey) {
          const key = findSharedApiKey(nds)
          if (key) (newNode.data as Record<string, unknown>).apiKey = key
        }
        return [...nds, newNode]
      })
    },
    [rfInstance, setNodes],
  )

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (node.type === 'tableOutput' || node.type === 'jsonOutput') {
      setExpandedNodeId(prev => (prev === node.id ? null : node.id))
    }
  }, [])

  // ── Connection suggestions ─────────────────────────────────────────────────

  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (!state.fromNode || state.toNode) return   // normal connection or no drag — nothing to do
    const { clientX, clientY } = 'changedTouches' in event ? event.changedTouches[0] : event

    if (state.fromHandle?.type === 'source') {
      // Forward drag: output handle → empty canvas → show node suggestions
      setConnMenu({
        x: clientX, y: clientY,
        sourceNodeId:   state.fromNode.id,
        sourceNodeType: state.fromNode.type ?? '',
        sourceHandleId: state.fromHandle?.id ?? null,
      })
      return
    }

    if (state.fromHandle?.type === 'target') {
      // Reverse drag: input handle → empty canvas → auto-create a Param node
      const handleId = state.fromHandle.id
      if (!handleId || handleId === 'data' || handleId === 'results') return
      if (!rfInstance) return
      const position = rfInstance.screenToFlowPosition({ x: clientX - 20, y: clientY - 20 })
      const newParam  = NODE_DEFAULTS['param'](position)
      const targetId  = state.fromNode!.id
      setNodes(prev => [...prev, newParam as AppNode])
      setEdges(prev => {
        const base = SINGLETON_TARGET_HANDLES.has(handleId)
          ? prev.filter(e => !(e.target === targetId && e.targetHandle === handleId))
          : prev
        return addEdge({
          id:           `e-${newParam.id}-${targetId}`,
          source:       newParam.id,
          target:       targetId,
          targetHandle: handleId,
        }, base)
      })
    }
  }, [rfInstance, setNodes, setEdges])

  // Create node + edge immediately (used when targetHandle is already known)
  const createNodeWithEdge = useCallback((
    nodeType: string,
    targetHandle: string,
    x: number, y: number,
    sourceNodeId: string,
    sourceHandleId: string | null,
  ) => {
    if (!rfInstance) return
    const factory = NODE_DEFAULTS[nodeType]
    if (!factory) return
    const position = rfInstance.screenToFlowPosition({ x: x + 20, y: y - 20 })
    const newNode  = factory(position) as AppNode
    if (KCL_API_KEY_NODES.has(nodeType) && !(newNode.data as { apiKey?: string }).apiKey) {
      const key = findSharedApiKey(rfInstance.getNodes())
      if (key) (newNode.data as Record<string, unknown>).apiKey = key
    }
    setNodes(prev => [...prev, newNode as AppNode])
    setEdges(prev => addEdge({
      id:           `e-${sourceNodeId}-${newNode.id}`,
      source:       sourceNodeId,
      sourceHandle: sourceHandleId ?? undefined,
      target:       newNode.id,
      targetHandle,
    }, prev))
  }, [rfInstance, setNodes, setEdges])

  const handleSuggestionSelect = useCallback((s: Suggestion) => {
    if (!connMenu) return

    if (s.targetHandle !== null) {
      // Direct connection — handle is unambiguous
      createNodeWithEdge(s.type, s.targetHandle, connMenu.x, connMenu.y, connMenu.sourceNodeId, connMenu.sourceHandleId)
      return
    }

    // Multiple handles available — show the handle picker as a second step
    const handles = NODE_PARAM_HANDLES[s.type]
    if (!handles || handles.length === 0) return
    if (handles.length === 1) {
      createNodeWithEdge(s.type, handles[0].id, connMenu.x, connMenu.y, connMenu.sourceNodeId, connMenu.sourceHandleId)
      return
    }
    setHandlePicker({
      x: connMenu.x, y: connMenu.y,
      pendingNodeType:  s.type,
      pendingColor:     s.color,
      sourceNodeId:     connMenu.sourceNodeId,
      sourceHandleId:   connMenu.sourceHandleId,
    })
  }, [connMenu, createNodeWithEdge])

  const handlePickerSelect = useCallback((handleId: string) => {
    if (!handlePicker) return
    createNodeWithEdge(
      handlePicker.pendingNodeType, handleId,
      handlePicker.x, handlePicker.y,
      handlePicker.sourceNodeId, handlePicker.sourceHandleId,
    )
    setHandlePicker(null)
  }, [handlePicker, createNodeWithEdge])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <div style={topBarStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
          <span style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
            <b>N</b>ational <b>F</b>ederated <b>C</b>ompute <b>S</b>ervices
            {' – '}
            <em style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 400 }}>Arts &amp; Humanities</em>
          </span>
          <span style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.02em' }}>Proof of Concept. V2.0</span>
        </div>
        <div style={{ flex: 1 }} />
        <button
          style={templateBtnStyle}
          onClick={handleSave}
          title="Save workflow configuration to a JSON file"
          disabled={nodes.length === 0}
        >
          💾 Save
        </button>
        <button
          style={templateBtnStyle}
          onClick={() => fileInputRef.current?.click()}
          title="Load workflow configuration from a JSON file"
        >
          📂 Load
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleLoadFile}
        />
        {(() => {
          const selected = nodes.filter(n => n.selected && n.type !== 'group')
          const groupSelected = nodes.find(n => n.selected && n.type === 'group')
          return (
            <>
              {selected.length >= 2 && (
                <button
                  style={templateBtnStyle}
                  onClick={handleGroupSelected}
                  title={`Group ${selected.length} selected nodes`}
                >
                  📦 Group ({selected.length})
                </button>
              )}
              {groupSelected && (
                <button
                  style={templateBtnStyle}
                  onClick={handleUngroup}
                  title={`Ungroup "${ (groupSelected.data as { name?: string }).name ?? 'Group' }"`}
                >
                  📤 Ungroup
                </button>
              )}
              {selected.length > 0 && (
                <span style={{ fontSize: 11, color: '#6b7280', marginRight: 4 }}>
                  {selected.length} selected
                </span>
              )}
            </>
          )
        })()}
        {loadError && (
          <span style={{ fontSize: 11, color: '#dc2626', maxWidth: 200 }} title={loadError}>
            ⚠ {loadError}
          </span>
        )}
        <button
          style={{ ...templateBtnStyle, background: chatOpen ? '#881337' : undefined, color: chatOpen ? '#fff' : undefined, borderColor: chatOpen ? '#881337' : undefined }}
          onClick={() => setChatOpen(v => !v)}
          title="Toggle KCL Assistant chat"
        >
          💬 Assistant
        </button>
        <button
          style={{ ...runAllBtnStyle, opacity: runningAll ? 0.6 : 1 }}
          onClick={handleRunAll}
          disabled={runningAll}
        >
          {runningAll ? '⏳ Running…' : '▶▶ Run All'}
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={sidebarStyle}>
          {(['Canvas', 'Input', 'Inspection', 'Data Services', 'Local Content', 'Filters and Transforms', 'Extraction and Enrichment', 'Output'] as const).map(group => {
            const items      = SIDEBAR_ITEMS.filter(i => i.group === group && !i.hidden)
            const isCollapsed = collapsedGroups.has(group)
            const toggleGroup = () => setCollapsedGroups(prev => {
              const next = new Set(prev)
              next.has(group) ? next.delete(group) : next.add(group)
              return next
            })
            return (
              <div key={group}>
                <div
                  style={{ ...sidebarHeading, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onClick={toggleGroup}
                >
                  <span>{group}</span>
                  <span style={{ fontSize: 9, color: '#d1d5db' }}>{isCollapsed ? '▶' : '▼'}</span>
                </div>
                {!isCollapsed && items.map(item => (
                  <div
                    key={item.type}
                    style={{ ...sidebarItemStyle, opacity: item.deprecated ? 0.55 : 1 }}
                    draggable
                    onDragStart={e => e.dataTransfer.setData('application/reactflow', item.type)}
                    title={item.deprecated ? 'Deprecated — service currently unavailable' : undefined}
                  >
                    <div style={{ ...sidebarDot, background: item.color }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12, textDecoration: item.deprecated ? 'line-through' : 'none', color: item.deprecated ? '#9ca3af' : undefined }}>
                        {item.label}
                        {item.deprecated && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#ef4444', textDecoration: 'none', verticalAlign: 'middle' }}>DEPRECATED</span>}
                      </div>
                      <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>{item.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 10, color: '#d1d5db', padding: '4px', lineHeight: 1.4 }}>
            Double-click a Table or JSON node to expand it
          </div>
        </div>

        {/* Canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={reactFlowWrapper} style={{ flex: 1 }}>
            {/* Prominent yellow selection ring */}
            <style>{`
              .react-flow__node.selectable.selected {
                box-shadow: 0 0 0 3px #f59e0b !important;
                outline: none !important;
              }
              .react-flow__node-input.selectable.selected,
              .react-flow__node-default.selectable.selected,
              .react-flow__node-output.selectable.selected,
              .react-flow__node-group.selectable.selected {
                box-shadow: 0 0 0 3px #f59e0b !important;
                outline: none !important;
              }
            `}</style>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setRfInstance}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeDoubleClick={onNodeDoubleClick}
              onConnectEnd={onConnectEnd}
              selectionOnDrag
              multiSelectionKeyCode="Shift"
              minZoom={0.1}
              fitView
            >
              <Background />
              <Controls />
              <MiniMap />
              <Panel position="bottom-left" style={attributionStyle}>
                Conceptualised by Neil Jakeman, King&#39;s Digital Lab
              </Panel>
              {/* Expanded output panel — lives inside RF so it can use RF hooks */}
              {expandedNodeId && (
                <ExpandedOutputPanel
                  nodeId={expandedNodeId}
                  onClose={() => setExpandedNodeId(null)}
                />
              )}
            </ReactFlow>
          </div>

          <DebugPanel nodes={nodes} />
        </div>

        {/* Right chat sidebar — outside ReactFlow so it doesn't scale with canvas zoom */}
        <ChatSidebar isOpen={chatOpen} onToggle={() => setChatOpen(v => !v)} />
      </div>

      {/* Connection suggestion popup — fixed-position so it's unaffected by canvas zoom */}
      {connMenu && (
        <ConnectionSuggestions
          x={connMenu.x}
          y={connMenu.y}
          sourceNodeType={connMenu.sourceNodeType}
          onSelect={handleSuggestionSelect}
          onClose={() => setConnMenu(null)}
        />
      )}

      {/* Secondary handle picker — shown when a param connects to a multi-handle node */}
      {handlePicker && (
        <HandlePicker
          x={handlePicker.x}
          y={handlePicker.y}
          handles={NODE_PARAM_HANDLES[handlePicker.pendingNodeType] ?? []}
          onSelect={handlePickerSelect}
          onClose={() => setHandlePicker(null)}
        />
      )}
    </div>
  )
}

// ─── Debug panel ──────────────────────────────────────────────────────────────

function DebugPanel({ nodes }: { nodes: AppNode[] }) {
  const [open, setOpen] = useState(false)

  const slim = nodes.map(n => {
    const d = n.data as Record<string, unknown>
    const isSearchNode = n.type === 'gbifSearch' || n.type === 'lldsSearch' || n.type === 'adsSearchAdvanced' || n.type === 'mdsSearch' || n.type === 'adsLibrarySearch' || n.type === 'ariadneSearch' || n.type === 'hsdsSearch'
    if (isSearchNode && d.results) {
      const recs = d.results as UnifiedRecord[]
      return {
        id: n.id, type: n.type,
        data: { ...d, results: `[${recs.length} UnifiedRecord(s) — first._source: ${recs[0]?._source}]` },
      }
    }
    return { id: n.id, type: n.type, data: n.data }
  })

  return (
    <div style={debugOuter}>
      <button style={debugToggle} onClick={() => setOpen(o => !o)}>
        {open ? '▼' : '▲'} Debug — node data ({nodes.length} nodes)
      </button>
      {open && (
        <pre style={debugPre}>{JSON.stringify(slim, null, 2)}</pre>
      )}
    </div>
  )
}

// ─── styles ───────────────────────────────────────────────────────────────────

const attributionStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(4px)',
  border: '1px solid #e5e7eb', borderRadius: 4,
  padding: '3px 8px', fontSize: 10, color: '#9ca3af',
  fontFamily: 'inherit', letterSpacing: '0.01em',
  pointerEvents: 'none',
}

const topBarStyle: React.CSSProperties = {
  height: 40, background: '#fff', borderBottom: '1px solid #e5e7eb',
  display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', flexShrink: 0,
}

const templateBtnStyle: React.CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6,
  padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

const runAllBtnStyle: React.CSSProperties = {
  background: '#0f4c81', color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

const sidebarStyle: React.CSSProperties = {
  width: 184, background: '#fff', borderRight: '1px solid #e5e7eb',
  display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 6, flexShrink: 0,
  overflowY: 'auto',
}

const sidebarHeading: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 4px', marginBottom: 2,
}

const sidebarItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
  borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'grab', userSelect: 'none',
}

const sidebarDot: React.CSSProperties = {
  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
}

const debugOuter: React.CSSProperties = {
  background: '#1e1e1e', color: '#d4d4d4', borderTop: '1px solid #333',
  flexShrink: 0, maxHeight: 200, display: 'flex', flexDirection: 'column',
}

const debugToggle: React.CSSProperties = {
  background: '#2d2d2d', border: 'none', color: '#9ca3af', fontSize: 11,
  padding: '4px 10px', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
}

const debugPre: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', overflowY: 'auto', flex: 1, margin: 0,
}
