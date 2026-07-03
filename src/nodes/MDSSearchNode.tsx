/**
 * MDS (Museum Data Service) search node — thin config over BackboneSearchNode
 * (task-SN.2). Handle ids/positions live in the shell. Two-step HTML scraper
 * capped at 200 results; the status text turns amber when capped. The runner
 * (runMDSNode.ts) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
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
  theme: {
    header:       '#1e3a8a',  // dark navy — distinct from all other nodes
    runBtn:       '#1e40af',
    accentBg:     '#eff6ff',  // unused (no filter panel) — kept for theme completeness
    accentBorder: '#bfdbfe',
    sectionBg:    '#eff6ff',
    clearBtn:     '#1e40af',
    fixtureIcon:  '#1e3a8a',
  },
  queryLabel:       'q',
  queryPlaceholder: 'e.g. Roman coin',
  minWidth:         240,
  cappedAmberStatus: true,
  footer: { caption: 'Scrapes museumdata.uk — not a formal API' },
}

export function MDSSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={MDS_CONFIG} />
}
