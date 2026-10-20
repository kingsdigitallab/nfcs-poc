/**
 * NHM Data Portal search node — thin config over BackboneSearchNode (the
 * shared search shell). Handle ids/positions live in the shell (query row 0,
 * limit row 1, output `results`). The `resource` body row switches between
 * the Specimen collection and the Index Lots resource; the Filters panel maps
 * 1:1 onto CKAN `filters` keys (single value each — the service rejects
 * arrays). See docs/handoff-nhm-search-node.md for the verified API facts.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type NHMStatus = 'idle' | 'loading' | 'success' | 'error' | 'cached'

export type NHMResource = 'specimens' | 'indexlots'

export interface NHMSearchNodeData {
  inlineQuery:    string
  inlineLimit:    string
  fetchAll:       boolean
  /** Which CKAN resource to query — maps to a resource_id in runNHMNode.ts */
  resource:       NHMResource
  /** 'relevance' omits `sort`; otherwise passed verbatim ('year asc' | 'year desc') */
  sort:           string
  // Filters panel — each is one `filters` key, single value, omitted when ''
  collectionCode: string
  country:        string
  year:           string
  typeStatus:     string
  basisOfRecord:  string
  useFixture?:    boolean
  status:         NHMStatus
  statusMessage:  string
  results:        UnifiedRecord[] | undefined
  count:          number
  [key: string]:  unknown
}

export const NHM_CONFIG: BackboneSearchConfig = {
  nodeType: 'nhmSearch',
  title:    'NHM Search',
  theme: deriveBackboneTheme(NODE_IDENTITY.nhmSearch),
  queryPlaceholder: 'e.g. Stonehenge',
  fetchAll: { label: 'Fetch all (up to 2,000)' },
  extraBodyRow: {
    key: 'resource', label: 'resource',
    options: [
      { value: 'specimens', label: 'Specimens' },
      { value: 'indexlots', label: 'Index lots' },
    ],
  },
  sort: {
    singleSelect: true,
    defaultValue: 'relevance',
    options: [
      { value: 'relevance', label: 'Relevance' },
      { value: 'year asc',  label: 'Year ↑' },
      { value: 'year desc', label: 'Year ↓' },
    ],
  },
  filters: [
    {
      key: 'collectionCode', label: 'Collection', kind: 'select',
      options: [
        { value: '',        label: '— any —' },
        { value: 'BOT',     label: 'BOT — Botany' },
        { value: 'ZOO',     label: 'ZOO — Zoology' },
        { value: 'BMNH(E)', label: 'BMNH(E) — Entomology' },
        { value: 'PAL',     label: 'PAL — Palaeontology' },
        { value: 'MIN',     label: 'MIN — Mineralogy & Petrology' },
      ],
    },
    { key: 'country',    label: 'Country',     kind: 'text', placeholder: 'e.g. United Kingdom' },
    { key: 'year',       label: 'Year',        kind: 'text', placeholder: 'exact year only, e.g. 1882' },
    { key: 'typeStatus', label: 'Type status', kind: 'text', placeholder: 'e.g. Holotype' },
    {
      key: 'basisOfRecord', label: 'Basis', kind: 'select',
      options: [
        { value: '',                  label: '— any —' },
        { value: 'PreservedSpecimen', label: 'PreservedSpecimen' },
        { value: 'FossilSpecimen',    label: 'FossilSpecimen' },
        { value: 'Occurrence',        label: 'Occurrence (minerals & rocks)' },
      ],
    },
  ],
  cappedAmberStatus: true,
}

export function NHMSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={NHM_CONFIG} />
}
