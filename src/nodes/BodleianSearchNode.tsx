/**
 * Bodleian Digital Collections search node — thin config over
 * BackboneSearchNode (task-SN.4). Handle ids/positions live in the shell.
 * The runner (runBodleianSearchNode.ts — rows/page pagination over the
 * {totalItems, member, view} envelope, dual fetchAll/limited terminal paths,
 * fq* filter building) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type BodleianStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface BodleianSearchNodeData {
  inlineQuery:       string
  inlineLimit:       string
  fetchAll:          boolean
  sort:              string
  fqCompleteness?:   string   // '' | 'Yes' | 'No'
  fqOrigins?:        string
  fqLanguages?:      string
  fqMusicalNotation?: string  // '' | 'Yes' | 'No'
  fqDateFrom?:       string
  fqDateTo?:         string
  useFixture?:       boolean
  status:            BodleianStatus
  statusMessage:     string
  results:           UnifiedRecord[] | undefined
  count:             number
  [key: string]:     unknown
}

export const BODLEIAN_CONFIG: BackboneSearchConfig = {
  nodeType: 'bodleianSearch',
  title:    'Bodleian Digital Collections',
  theme: deriveBackboneTheme(NODE_IDENTITY.bodleianSearch),
  queryPlaceholder: 'e.g. psalter',
  fetchAll: { label: 'Fetch all (up to 500)' },
  sort: {
    singleSelect: true,
    defaultValue: 'relevance',
    options: [
      { value: 'relevance',     label: 'Relevance' },
      { value: 'shelfmark',     label: 'Shelfmark' },
      { value: 'date asc',      label: 'Date ↑' },
      { value: 'date desc',     label: 'Date ↓' },
      { value: 'published asc', label: 'Published ↑' },
    ],
  },
  filters: [
    {
      key: 'fqCompleteness', label: 'Complete', kind: 'select',
      options: [
        { value: '',    label: 'Any' },
        { value: 'Yes', label: 'Fully digitised' },
        { value: 'No',  label: 'Partial only' },
      ],
    },
    { key: 'fqOrigins',   label: 'Origins',  kind: 'text', placeholder: 'e.g. England, France' },
    { key: 'fqLanguages', label: 'Language', kind: 'text', placeholder: 'e.g. Latin, Hebrew' },
    {
      key: 'fqMusicalNotation', label: 'Music', kind: 'select',
      options: [
        { value: '',    label: 'Any' },
        { value: 'Yes', label: 'Has musical notation' },
        { value: 'No',  label: 'No musical notation' },
      ],
    },
    { key: 'fqDate', label: 'Date', kind: 'range', rangePlaceholders: ['e.g. 1200', 'e.g. 1400'] },
  ],
  statusColours:      { cached: '#0e7490' },
  statusBadgeColours: { cached: '#67e8f9' },
}

export function BodleianSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={BODLEIAN_CONFIG} />
}
