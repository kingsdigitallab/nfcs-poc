/**
 * V&A (Victoria & Albert Museum) search node — thin config over
 * BackboneSearchNode (task-SN.3). Handle ids/positions live in the shell.
 * The runner (runVASearchNode.ts, page/page_size pagination over the V&A
 * API v2 envelope) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'

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
  theme: {
    header:       '#9f1239',  // rose-800
    runBtn:       '#be123c',
    accentBg:     '#fff1f2',
    accentBorder: '#fecdd3',
    sectionBg:    '#fff1f2',
    clearBtn:     '#9f1239',
    fixtureIcon:  '#9f1239',
  },
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
