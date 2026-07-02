import type { Node } from '@xyflow/react'
import type { UnifiedRecord } from './UnifiedRecord'
import type { LocalFolderSourceNodeData } from '../nodes/LocalFolderSourceNode'
import type { LocalFileSourceNodeData }   from '../nodes/LocalFileSourceNode'
import type { OllamaNodeData }            from '../nodes/OllamaNode'
import type { OllamaFieldNodeData }       from '../nodes/OllamaFieldNode'
import type { KCLNodeData }              from '../nodes/KCLNode'
import type { KCLFieldNodeData }         from '../nodes/KCLFieldNode'
import type { EvaluatorNodeData }        from '../nodes/EvaluatorNode'
import type { HTMLPreviewNodeData }      from '../nodes/HTMLPreviewNode'
import type { URLFetchNodeData }          from '../nodes/URLFetchNode'
import type { HTMLSectionNodeData }       from '../nodes/HTMLSectionNode'
import type { LLDSSearchNodeData }        from '../nodes/LLDSSearchNode'
import type { ADSSearchAdvancedNodeData }     from '../nodes/ADSSearchAdvancedNode'
import type { ADSLibraryNodeData }            from '../nodes/ADSLibraryNode'
import type { MDSSearchNodeData }         from '../nodes/MDSSearchNode'
import type { ReconciliationNodeData }    from '../nodes/ReconciliationNode'
import type { FilterTransformNodeData }   from '../nodes/FilterTransformNode'
import type { SpatialFilterNodeData }     from '../nodes/SpatialFilterNode'
import type { DeduplicateNodeData }       from '../nodes/DeduplicateNode'
import type { ExportNodeData }            from '../nodes/ExportNode'
import type { QuickViewNodeData }         from '../nodes/QuickViewNode'
import type { CommentNodeData }           from '../nodes/CommentNode'
import type { MergeByQIDNodeData }        from '../nodes/MergeByQIDNode'
import type { WikidataEnrichNodeData }    from '../nodes/WikidataEnrichNode'
import type { SaveSearchNodeData }        from '../nodes/SaveSearchNode'
import type { LoadSavedSearchNodeData }  from '../nodes/LoadSavedSearchNode'
import type { XMLSectionNodeData }       from '../nodes/XMLSectionNode'
import type { ImageViewNodeData }        from '../nodes/ImageViewNode'
import type { CitationNodeData }           from '../nodes/CitationNode'
import type { EuropeanaSearchNodeData }    from '../nodes/EuropeanaSearchNode'
import type { ARIADNESearchNodeData }      from '../nodes/ARIADNESearchNode'
import type { HSDSSearchNodeData }         from '../nodes/HSDSSearchNode'
import type { BodleianSearchNodeData }     from '../nodes/BodleianSearchNode'
import type { FieldDistributionNodeData }  from '../nodes/FieldDistributionNode'
import type { TimelineOutputNodeData }     from '../nodes/TimelineOutputNode'
import type { MapOutputNodeData }          from '../nodes/MapOutputNode'
import type { SMGSearchNodeData }          from '../nodes/SMGSearchNode'
import type { VASearchNodeData }           from '../nodes/VASearchNode'
import type { GeocodingNodeData }          from '../nodes/GeocodingNode'
import type { FrameSenseSourceNodeData }  from '../nodes/FrameSenseSourceNode'
import type { SampleDataSourceNodeData } from '../nodes/SampleDataSourceNode'
import type { SourceProfileNodeData }    from '../nodes/SourceProfileNode'
import type { SmartFilterNodeData }      from '../nodes/SmartFilterNode'
import type { SmartGeocoderNodeData }   from '../nodes/SmartGeocoderNode'
import type { QuickStartNodeData }      from '../nodes/QuickStartNode'
import type { GroupNodeData }           from '../nodes/GroupNode'
import type { QuickNoteNodeData }       from '../nodes/QuickNoteNode'
import type { ComparisonReportNodeData } from '../nodes/ComparisonReportNode'

// ─── Slim inline data types ────────────────────────────────────────────────────

export interface ParamNodeData  { label: string; paramType: string; value: string; [k: string]: unknown }
export interface SearchNodeData { status: string; statusMessage: string; results?: UnifiedRecord[]; count?: number; [k: string]: unknown }
export interface OutputNodeData { [k: string]: unknown }

// ─── AppNode union ─────────────────────────────────────────────────────────────

export type AppNode =
  | Node<ParamNodeData>
  | Node<SearchNodeData>
  | Node<LocalFolderSourceNodeData>
  | Node<LocalFileSourceNodeData>
  | Node<OllamaNodeData>
  | Node<OllamaFieldNodeData>
  | Node<KCLNodeData>
  | Node<KCLFieldNodeData>
  | Node<EvaluatorNodeData>
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
  | Node<SampleDataSourceNodeData>
  | Node<SourceProfileNodeData>
  | Node<SmartFilterNodeData>
  | Node<SmartGeocoderNodeData>
  | Node<QuickStartNodeData>
  | Node<GroupNodeData>
  | Node<QuickNoteNodeData>
  | Node<ComparisonReportNodeData>
  | Node<OutputNodeData>
