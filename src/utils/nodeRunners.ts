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
import { runGBIFNode } from './runGBIFNode'
import { runLLDSNode } from './runLLDSNode'
import { runADSNode }  from './runADSNode'
import { runMDSNode }  from './runMDSNode'

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
  gbifSearch: runGBIFNode,
  lldsSearch: runLLDSNode,
  adsSearch:  runADSNode,
  mdsSearch:  runMDSNode,
  // normalize: runNormalizeNode,
}
