/**
 * HSDS (Heritage Science Data Service) search node — thin config over
 * BackboneSearchNode (the shared ARIADNE-backbone shell). Handle
 * ids/positions live in the shell.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type HSDSStatus = 'idle' | 'loading' | 'success' | 'error'

export interface HSDSSearchNodeData {
  inlineQuery:    string
  inlineLimit:    string
  fetchAll:       boolean
  ariadneSubject: string
  derivedSubject: string
  nativeSubject:  string
  country:        string
  dataType:       string
  temporal:       string
  contributor:    string
  sort:           string
  order:          string
  useFixture?:    boolean
  status:         HSDSStatus
  statusMessage:  string
  results:        UnifiedRecord[] | undefined
  count:          number
  [key: string]:  unknown
}

export const HSDS_CONFIG: BackboneSearchConfig = {
  nodeType: 'hsdsSearch',
  title:    'HSDS Search',
  theme: deriveBackboneTheme(NODE_IDENTITY.hsdsSearch),
  fetchAll: true,
  sort: {
    options: [
      { value: '_score',   label: 'Relevance' },
      { value: 'title',    label: 'Title' },
      { value: 'issued',   label: 'Date issued' },
      { value: 'modified', label: 'Last modified' },
    ],
  },
  filters: [
    {
      key: 'ariadneSubject', label: 'Resource type', kind: 'select',
      options: [
        '', 'Site/monument', 'Artefact', 'Coin', 'Fieldwork', 'Fieldwork report',
        'Maritime', 'Monument', 'Inscription', 'Date', 'Fieldwork archive',
        'Rock Art', 'Building survey', 'E-Publication', 'Scientific analysis',
        'Not provided', 'Burial',
      ],
    },
    {
      key: 'derivedSubject', label: 'Getty subject', kind: 'text',
      placeholder: 'e.g. hillforts',
      suggestions: [
        'archaeological sites', 'earthworks (engineering works)', 'monuments',
        'buildings (structures)', 'ditches', 'enclosures', 'field systems',
        'farmsteads', 'churches', 'castles', 'roads', 'bridges',
        'industrial sites', 'burial mounds', 'hillforts',
      ],
    },
    {
      key: 'nativeSubject', label: 'Native subject', kind: 'text',
      placeholder: 'e.g. henge',
      suggestions: [
        'site', 'building', 'monument', 'find', 'findspot', 'earthwork',
        'enclosure', 'ditch', 'field system', 'farmstead', 'henge',
        'stone circle', 'burial mound', 'hillfort', 'church', 'castle',
      ],
    },
    {
      key: 'country', label: 'Country', kind: 'select',
      options: [
        '', 'England', 'Scotland', 'Wales', 'Northern Ireland',
        'United Kingdom', 'Isle of Man', 'Great Britain', 'Ireland',
        'Republic of Ireland', 'Channel Islands',
      ],
    },
    {
      key: 'dataType', label: 'Data type', kind: 'select',
      options: [
        '', 'Structured Data', 'Still Image', 'Text', 'Geospatial',
        'CAD', 'Numeric', '3D', 'Video', 'Other', 'Audio', 'Software',
      ],
    },
    {
      key: 'temporal', label: 'Period', kind: 'select',
      options: [
        '', 'post medieval', 'roman', 'medieval', '19th century', 'bronze age',
        '20th century', 'early medieval', 'iron age', 'neolithic', 'prehistoric',
        'second world war', 'mesolithic', 'modern', '18th century',
        'later prehistoric', 'unknown', 'palaeolithic', 'late iron age',
        'early bronze age', 'late bronze age',
      ],
    },
    {
      key: 'contributor', label: 'Contributor', kind: 'select',
      options: [
        '', 'Archaeology Data Service', 'Historic England',
        'Portable Antiquities Scheme', 'Historic Environment Scotland',
        'Cadw', 'Historic Environment Wales',
      ],
    },
  ],
}

export function HSDSSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={HSDS_CONFIG} />
}
