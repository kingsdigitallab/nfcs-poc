import { LocalFolderSourceNode } from './LocalFolderSourceNode'
import { LocalFileSourceNode }   from './LocalFileSourceNode'
import { OllamaNode }            from './OllamaNode'
import { OllamaFieldNode }       from './OllamaFieldNode'
import { URLFetchNode }          from './URLFetchNode'
import { ParamNode } from './ParamNode'
import { GBIFSearchNode } from './GBIFSearchNode'
import { LLDSSearchNode } from './LLDSSearchNode'
import { ADSSearchAdvancedNode } from './ADSSearchAdvancedNode'
import { ADSLibraryNode }        from './ADSLibraryNode'
import { MDSSearchNode }  from './MDSSearchNode'
import { ReconciliationNode }    from './ReconciliationNode'
import { FilterTransformNode }  from './FilterTransformNode'
import { SpatialFilterNode }    from './SpatialFilterNode'
import { TableOutputNode }    from './TableOutputNode'
import { JSONOutputNode }     from './JSONOutputNode'
import { MapOutputNode }      from './MapOutputNode'
import { TimelineOutputNode, TimelineViewNode } from './TimelineOutputNode'
import { ExportNode }         from './ExportNode'
import { OllamaOutputNode }   from './OllamaOutputNode'
import { HTMLSectionNode }    from './HTMLSectionNode'
import { QuickViewNode }      from './QuickViewNode'
import { CommentNode }        from './CommentNode'
import { MergeByQIDNode }        from './MergeByQIDNode'
import { WikidataEnrichNode }    from './WikidataEnrichNode'
import { SaveSearchNode }        from './SaveSearchNode'
import { LoadSavedSearchNode }   from './LoadSavedSearchNode'
import { XMLSectionNode }        from './XMLSectionNode'
import { ImageViewNode }         from './ImageViewNode'
import { CitationNode }             from './CitationNode'
import { EuropeanaSearchNode }     from './EuropeanaSearchNode'
import { FieldDistributionNode }   from './FieldDistributionNode'
import { ARIADNESearchNode }       from './ARIADNESearchNode'
import { HSDSSearchNode }          from './HSDSSearchNode'
import { BodleianSearchNode }      from './BodleianSearchNode'
import { KCLNode }                  from './KCLNode'
import { KCLFieldNode }             from './KCLFieldNode'
import { KCLOutputNode }            from './KCLOutputNode'
import { EvaluatorNode }            from './EvaluatorNode'
import { HTMLPreviewNode }          from './HTMLPreviewNode'
import { DeduplicateNode }          from './DeduplicateNode'
import { SMGSearchNode }            from './SMGSearchNode'
import { VASearchNode }             from './VASearchNode'
import { GeocodingNode }            from './GeocodingNode'
import { SmartGeocoderNode }       from './SmartGeocoderNode'
import { FrameSenseSourceNode }     from './FrameSenseSourceNode'
import { SampleDataSourceNode }    from './SampleDataSourceNode'
import { SourceProfileNode }        from './SourceProfileNode'
import { SmartFilterNode }          from './SmartFilterNode'
import { QuickStartNode }           from './QuickStartNode'
import { GroupNode }                from './GroupNode'
import { QuickNoteNode }            from './QuickNoteNode'
import { ComparisonReportNode }     from './ComparisonReportNode'
import { withToolbar }              from './withToolbar'

export const nodeTypes = {
  param:             withToolbar(ParamNode),
  localFolderSource: withToolbar(LocalFolderSourceNode),
  localFileSource:   withToolbar(LocalFileSourceNode),
  ollamaNode:        withToolbar(OllamaNode),
  ollamaField:       withToolbar(OllamaFieldNode),
  urlFetch:          withToolbar(URLFetchNode),
  gbifSearch:        withToolbar(GBIFSearchNode),
  lldsSearch:        withToolbar(LLDSSearchNode),
  adsSearchAdvanced: withToolbar(ADSSearchAdvancedNode),
  adsLibrarySearch:  withToolbar(ADSLibraryNode),
  mdsSearch:         withToolbar(MDSSearchNode),
  reconciliation:    withToolbar(ReconciliationNode),
  filterTransform:   withToolbar(FilterTransformNode),
  spatialFilter:     withToolbar(SpatialFilterNode),
  tableOutput:       withToolbar(TableOutputNode),
  jsonOutput:        withToolbar(JSONOutputNode),
  mapOutput:         withToolbar(MapOutputNode),
  timelineOutput:    withToolbar(TimelineOutputNode),
  timelineView:      withToolbar(TimelineViewNode),
  export:            withToolbar(ExportNode),
  ollamaOutput:      withToolbar(OllamaOutputNode),
  htmlSection:       withToolbar(HTMLSectionNode),
  quickView:         withToolbar(QuickViewNode),
  comment:           withToolbar(CommentNode),
  mergeByQID:        withToolbar(MergeByQIDNode),
  wikidataEnrich:    withToolbar(WikidataEnrichNode),
  saveSearch:        withToolbar(SaveSearchNode),
  loadSavedSearch:   withToolbar(LoadSavedSearchNode),
  xmlSection:        withToolbar(XMLSectionNode),
  imageView:         withToolbar(ImageViewNode),
  citation:          withToolbar(CitationNode),
  europeanaSearch:   withToolbar(EuropeanaSearchNode),
  fieldDistribution: withToolbar(FieldDistributionNode),
  ariadneSearch:     withToolbar(ARIADNESearchNode),
  hsdsSearch:        withToolbar(HSDSSearchNode),
  bodleianSearch:    withToolbar(BodleianSearchNode),
  kclNode:           withToolbar(KCLNode),
  kclField:          withToolbar(KCLFieldNode),
  kclOutput:         withToolbar(KCLOutputNode),
  evaluatorNode:     withToolbar(EvaluatorNode),
  htmlPreview:       withToolbar(HTMLPreviewNode),
  deduplicate:       withToolbar(DeduplicateNode),
  smgSearch:         withToolbar(SMGSearchNode),
  vaSearch:          withToolbar(VASearchNode),
  geocoding:         withToolbar(GeocodingNode),
  smartGeocoder:     withToolbar(SmartGeocoderNode),
  frameSenseSource:  withToolbar(FrameSenseSourceNode),
  sampleDataSource:  withToolbar(SampleDataSourceNode),
  sourceProfile:     withToolbar(SourceProfileNode),
  smartFilter:       withToolbar(SmartFilterNode),
  quickStart:        withToolbar(QuickStartNode),
  group:             withToolbar(GroupNode),
  quickNote:         withToolbar(QuickNoteNode),
  comparisonReport:  withToolbar(ComparisonReportNode),
}

/**
 * Union of every canvas node type string — derived from the component
 * registry above, which is the most complete of the four registries.
 * The other registries (nodeRunners, NODE_DEFAULTS, SIDEBAR_ITEMS) apply
 * `satisfies` guards against this union so a typo or missing registration
 * fails compilation instead of silently dropping a node facet.
 */
export type NodeTypeId = keyof typeof nodeTypes
