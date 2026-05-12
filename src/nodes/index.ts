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
import { BodleianSearchNode }      from './BodleianSearchNode'
import { KCLNode }                  from './KCLNode'
import { KCLFieldNode }             from './KCLFieldNode'
import { KCLOutputNode }            from './KCLOutputNode'
import { HTMLPreviewNode }          from './HTMLPreviewNode'
import { DeduplicateNode }          from './DeduplicateNode'
import { SMGSearchNode }            from './SMGSearchNode'
import { VASearchNode }             from './VASearchNode'
import { GeocodingNode }            from './GeocodingNode'
import { FrameSenseSourceNode }     from './FrameSenseSourceNode'
import { SourceProfileNode }        from './SourceProfileNode'
import { withDuplicate }            from './withDuplicate'

export const nodeTypes = {
  param:             withDuplicate(ParamNode),
  localFolderSource: withDuplicate(LocalFolderSourceNode),
  localFileSource:   withDuplicate(LocalFileSourceNode),
  ollamaNode:        withDuplicate(OllamaNode),
  ollamaField:       withDuplicate(OllamaFieldNode),
  urlFetch:          withDuplicate(URLFetchNode),
  gbifSearch:        withDuplicate(GBIFSearchNode),
  lldsSearch:        withDuplicate(LLDSSearchNode),
  adsSearchAdvanced: withDuplicate(ADSSearchAdvancedNode),
  adsLibrarySearch:  withDuplicate(ADSLibraryNode),
  mdsSearch:         withDuplicate(MDSSearchNode),
  reconciliation:    withDuplicate(ReconciliationNode),
  filterTransform:   withDuplicate(FilterTransformNode),
  spatialFilter:     withDuplicate(SpatialFilterNode),
  tableOutput:       withDuplicate(TableOutputNode),
  jsonOutput:        withDuplicate(JSONOutputNode),
  mapOutput:         withDuplicate(MapOutputNode),
  timelineOutput:    withDuplicate(TimelineOutputNode),
  timelineView:      withDuplicate(TimelineViewNode),
  export:            withDuplicate(ExportNode),
  ollamaOutput:      withDuplicate(OllamaOutputNode),
  htmlSection:       withDuplicate(HTMLSectionNode),
  quickView:         withDuplicate(QuickViewNode),
  comment:           withDuplicate(CommentNode),
  mergeByQID:        withDuplicate(MergeByQIDNode),
  wikidataEnrich:    withDuplicate(WikidataEnrichNode),
  saveSearch:        withDuplicate(SaveSearchNode),
  loadSavedSearch:   withDuplicate(LoadSavedSearchNode),
  xmlSection:        withDuplicate(XMLSectionNode),
  imageView:         withDuplicate(ImageViewNode),
  citation:          withDuplicate(CitationNode),
  europeanaSearch:   withDuplicate(EuropeanaSearchNode),
  fieldDistribution: withDuplicate(FieldDistributionNode),
  ariadneSearch:     withDuplicate(ARIADNESearchNode),
  bodleianSearch:    withDuplicate(BodleianSearchNode),
  kclNode:           withDuplicate(KCLNode),
  kclField:          withDuplicate(KCLFieldNode),
  kclOutput:         withDuplicate(KCLOutputNode),
  htmlPreview:       withDuplicate(HTMLPreviewNode),
  deduplicate:       withDuplicate(DeduplicateNode),
  smgSearch:         withDuplicate(SMGSearchNode),
  vaSearch:          withDuplicate(VASearchNode),
  geocoding:         withDuplicate(GeocodingNode),
  frameSenseSource:  withDuplicate(FrameSenseSourceNode),
  sourceProfile:     withDuplicate(SourceProfileNode),
}
