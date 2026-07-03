/**
 * MDS (Museum Data Service) search node — thin config over BackboneSearchNode
 * (task-SN.2). Handle ids/positions live in the shell. Two-step HTML scraper
 * capped at 200 results; the status text turns amber when capped. The runner
 * (runMDSNode.ts) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type MDSStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface MDSSearchNodeData {
  inlineQuery: string
  inlineLimit: string
  status:        MDSStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  _capped:       boolean
  _total:        number
  useFixture?:   boolean
  [key: string]: unknown
}

export const MDS_CONFIG: BackboneSearchConfig = {
  nodeType: 'mdsSearch',
  title:    'MDS Search',
  theme: deriveBackboneTheme(NODE_IDENTITY.mdsSearch),
  queryLabel:       'q',
  queryPlaceholder: 'e.g. Roman coin',
  minWidth:         240,
  cappedAmberStatus: true,
  footer: { caption: 'Scrapes museumdata.uk — not a formal API' },
}

export function MDSSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={MDS_CONFIG} />
}
