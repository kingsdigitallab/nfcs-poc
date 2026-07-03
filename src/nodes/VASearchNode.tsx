/**
 * V&A (Victoria & Albert Museum) search node — thin config over
 * BackboneSearchNode (task-SN.3). Handle ids/positions live in the shell.
 * The runner (runVASearchNode.ts, page/page_size pagination over the V&A
 * API v2 envelope) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'

export type VAStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export interface VASearchNodeData {
  inlineQuery:   string
  inlineLimit:   string
  fetchAll:      boolean
  imagesOnly:    boolean
  yearFrom:      string
  yearTo:        string
  objectType:    string
  useFixture?:   boolean
  status:        VAStatus
  statusMessage: string
  count:         number
  [key: string]: unknown
}

export const VA_CONFIG: BackboneSearchConfig = {
  nodeType: 'vaSearch',
  title:    'Victoria & Albert Museum',
  theme: deriveBackboneTheme(NODE_IDENTITY.vaSearch),
  queryPlaceholder: 'e.g. ceramics',
  fetchAll: true,
  filters: [
    { key: 'imagesOnly', label: 'Images only', kind: 'checkbox' },
    { key: 'objectType', label: 'Object type', kind: 'text', placeholder: 'e.g. Vase' },
    { key: 'year',       label: 'Year',        kind: 'range', rangePlaceholders: ['e.g. 1800', 'e.g. 1900'] },
  ],
}

export function VASearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={VA_CONFIG} />
}
