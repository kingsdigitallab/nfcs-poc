/**
 * SMG (Science Museum Group) search node — thin config over
 * BackboneSearchNode (task-SN.3). Handle ids/positions live in the shell.
 * The `searchType` body row switches the runner's endpoint path
 * (/search/objects|people|documents); the runner (runSMGSearchNode.ts,
 * 0-indexed page[size]/page[number] pagination) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type SMGStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface SMGSearchNodeData {
  inlineQuery:   string
  inlineLimit:   string
  fetchAll:      boolean
  museum:        string
  dateFrom:      string
  dateTo:        string
  searchType:    string
  useFixture?:   boolean
  status:        SMGStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  [key: string]: unknown
}

export const SMG_CONFIG: BackboneSearchConfig = {
  nodeType: 'smgSearch',
  title:    'Science Museum Group',
  theme: deriveBackboneTheme(NODE_IDENTITY.smgSearch),
  queryPlaceholder: 'e.g. steam engine',
  extraBodyRow: {
    key: 'searchType',
    label: 'type',
    options: [
      { value: 'objects',   label: 'Objects' },
      { value: 'people',    label: 'People' },
      { value: 'documents', label: 'Documents' },
    ],
  },
  fetchAll: true,
  filters: [
    {
      key: 'museum', label: 'Museum', kind: 'select',
      options: [
        { value: '',                                  label: '— all museums —' },
        { value: 'Science Museum',                    label: 'Science Museum (London)' },
        { value: 'National Railway Museum',           label: 'National Railway Museum (York)' },
        { value: 'National Science and Media Museum', label: 'National Science and Media Museum (Bradford)' },
        { value: 'Museum of Science and Industry',    label: 'Museum of Science and Industry (Manchester)' },
        { value: 'Locomotion',                        label: 'Locomotion (Shildon)' },
      ],
    },
    { key: 'date', label: 'Date', kind: 'range', rangePlaceholders: ['e.g. 1850', 'e.g. 1900'] },
  ],
}

export function SMGSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={SMG_CONFIG} />
}
