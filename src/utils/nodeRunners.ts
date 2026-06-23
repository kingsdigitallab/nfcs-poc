/**
 * Runner registry — the single place where node types declare that they are
 * "runnable" and provide the function that executes them.
 *
 * To make a new node type runnable:
 *   1. Create src/utils/run<ServiceName>Node.ts conforming to NodeRunner.
 *   2. Import and add one line here.
 *   3. App.tsx and runWorkflow.ts require no changes.
 */
import type { Node, Edge } from '@xyflow/react'
import { runGBIFNode }            from './runGBIFNode'
import { runLLDSNode }            from './runLLDSNode'
import { runADSAdvancedNode }    from './runADSAdvancedNode'
import { runADSLibraryNode }     from './runADSLibraryNode'
import { runMDSNode }             from './runMDSNode'
import { runReconciliationNode }  from './runReconciliationNode'
import { runFilterTransformNode } from './runFilterTransformNode'
import { runSpatialFilterNode }   from './runSpatialFilterNode'
import { runHTMLSectionNode }     from './runHTMLSectionNode'
import { runURLFetchNode }        from './runURLFetchNode'
import { runOllamaNode }          from './runOllamaNode'
import { runOllamaFieldNode }     from './runOllamaFieldNode'
import { runMergeByQIDNode }      from './runMergeByQIDNode'
import { runWikidataEnrichNode }  from './runWikidataEnrichNode'
import { runXMLSectionNode }      from './runXMLSectionNode'
import { runEuropeanaNode }       from './runEuropeanaNode'
import { runARIADNENode }         from './runARIADNENode'
import { runHSDSNode }            from './runHSDSNode'
import { runKCLNode }             from './runKCLNode'
import { runKCLFieldNode }        from './runKCLFieldNode'
import { runBodleianSearchNode }  from './runBodleianSearchNode'
import { runTimelineViewNode }    from './runTimelineViewNode'
import { runImageViewNode }       from './runImageViewNode'
import { runDeduplicateNode }     from './runDeduplicateNode'
import { runMapOutputNode }       from './runMapOutputNode'
import { runSMGSearchNode }       from './runSMGSearchNode'
import { runVASearchNode }        from './runVASearchNode'
import { runGeocodingNode }       from './runGeocodingNode'
import { runSmartGeocoderNode }  from './runSmartGeocoderNode'
import { runSampleDataNode }     from './runSampleDataNode'
import runCommentNode            from './runCommentNode'
import { runEvaluatorNode }      from './runEvaluatorNode'
import { withFixture }            from './fixtureUtils'

/**
 * Common signature for every node runner.
 *
 * Runners must NEVER throw. They own their error handling and must always
 * leave the node in a terminal status ('success' | 'cached' | 'error') before
 * returning. If a runner throws despite this contract, runWorkflow.ts will
 * catch it, mark the node as errored, and continue the rest of the workflow.
 */
export type NodeRunner = (
  nodeId: string,
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
) => Promise<void>

export const nodeRunners: Record<string, NodeRunner> = {
  comment:           runCommentNode,
  gbifSearch:        withFixture('gbifSearch',      runGBIFNode),
  lldsSearch:        withFixture('lldsSearch',      runLLDSNode),
  mdsSearch:         withFixture('mdsSearch',       runMDSNode),
  europeanaSearch:   withFixture('europeanaSearch', runEuropeanaNode),
  ariadneSearch:     withFixture('ariadneSearch',   runARIADNENode),
  hsdsSearch:        withFixture('hsdsSearch', runHSDSNode),
  bodleianSearch:    withFixture('bodleianSearch',  runBodleianSearchNode),
  adsSearchAdvanced: withFixture('adsSearchAdvanced', runADSAdvancedNode),
  adsLibrarySearch:  runADSLibraryNode,
  reconciliation:    runReconciliationNode,
  filterTransform:   runFilterTransformNode,
  spatialFilter:     runSpatialFilterNode,
  htmlSection:       runHTMLSectionNode,
  urlFetch:          runURLFetchNode,
  ollamaNode:        runOllamaNode,
  ollamaField:       runOllamaFieldNode,
  kclNode:           runKCLNode,
  kclField:          runKCLFieldNode,
  evaluatorNode:     runEvaluatorNode,
  mergeByQID:        runMergeByQIDNode,
  wikidataEnrich:    runWikidataEnrichNode,
  xmlSection:        runXMLSectionNode,
  timelineView:      runTimelineViewNode,
  timelineOutput:    runTimelineViewNode,  // backward-compat alias
  imageView:         runImageViewNode,
  deduplicate:       runDeduplicateNode,
  mapOutput:         runMapOutputNode,
  smgSearch:         withFixture('smgSearch', runSMGSearchNode),
  vaSearch:          withFixture('vaSearch',  runVASearchNode),
  geocoding:         runGeocodingNode,
  smartGeocoder:     runSmartGeocoderNode,
  sampleDataSource:  runSampleDataNode,
}

