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
import { TimelineOutputNode } from './TimelineOutputNode'
import { ExportNode }         from './ExportNode'
import { OllamaOutputNode }   from './OllamaOutputNode'
import { HTMLSectionNode }    from './HTMLSectionNode'
import { QuickViewNode }      from './QuickViewNode'
import { CommentNode }        from './CommentNode'
import { MergeByQIDNode }     from './MergeByQIDNode'
import { WikidataEnrichNode } from './WikidataEnrichNode'

export const nodeTypes = {
  param:             ParamNode,
  localFolderSource: LocalFolderSourceNode,
  localFileSource:   LocalFileSourceNode,
  ollamaNode:        OllamaNode,
  ollamaField:       OllamaFieldNode,
  urlFetch:          URLFetchNode,
  gbifSearch:     GBIFSearchNode,
  lldsSearch:     LLDSSearchNode,
  adsSearchAdvanced:  ADSSearchAdvancedNode,
  adsLibrarySearch:   ADSLibraryNode,
  mdsSearch:      MDSSearchNode,
  reconciliation:  ReconciliationNode,
  filterTransform: FilterTransformNode,
  spatialFilter:  SpatialFilterNode,
  tableOutput:    TableOutputNode,
  jsonOutput:     JSONOutputNode,
  mapOutput:      MapOutputNode,
  timelineOutput: TimelineOutputNode,
  export:         ExportNode,
  ollamaOutput:   OllamaOutputNode,
  htmlSection:    HTMLSectionNode,
  quickView:      QuickViewNode,
  comment:        CommentNode,
  mergeByQID:     MergeByQIDNode,
  wikidataEnrich: WikidataEnrichNode,
}
