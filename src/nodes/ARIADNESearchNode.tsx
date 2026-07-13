/**
 * ARIADNE portal search node — thin config over BackboneSearchNode (the
 * shared ARIADNE-backbone shell). Handle ids/positions live in the shell.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import { NODE_IDENTITY, deriveBackboneTheme } from '../styles/theme'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type ARIADNEStatus = 'idle' | 'loading' | 'success' | 'error'

export interface ARIADNESearchNodeData {
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
  useFixture?:    boolean
  order:          string
  status:         ARIADNEStatus
  statusMessage:  string
  results:        UnifiedRecord[] | undefined
  count:          number
  [key: string]:  unknown
}

export const ARIADNE_CONFIG: BackboneSearchConfig = {
  nodeType: 'ariadneSearch',
  title:    'ARIADNE Search',
  theme: deriveBackboneTheme(NODE_IDENTITY.ariadneSearch),
  fetchAll: true,
  sort: {
    options: [
      { value: '_score', label: 'Relevance' },
      { value: 'title',  label: 'Title' },
      { value: 'issued', label: 'Date issued' },
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
      placeholder: 'e.g. barrows',
      suggestions: [
        'early western world coins', 'houses', 'archaeological sites',
        'vessels (containers)', 'earthworks (engineering works)', 'buckles (strap accessories)',
        'brooches', 'penny coins', 'agricultural settlements', 'buildings (structures)',
        'wrecks (sites)', 'farms', 'ditches', 'pits (earthworks)', 'glass (material)',
        'windows', 'stained-glass windows', 'conservation (discipline)', 'boundaries',
        'coins (money)',
      ],
    },
    {
      key: 'nativeSubject', label: 'Native subject', kind: 'text',
      placeholder: 'e.g. bowl barrow',
      suggestions: [
        'coin', 'geophysical survey', 'house', 'vessel', 'extant building',
        'findspot', 'buckle', 'site', 'brooch', 'building', 'wreck', 'earthwork',
        'penny', 'enclosure', 'find', 'pit', 'farmstead', 'ditch', 'field system',
        'cemetery',
      ],
    },
    {
      key: 'country', label: 'Country', kind: 'select',
      options: [
        '', 'England', 'Scotland', 'Wales', 'Ireland', 'Northern Ireland',
        'United Kingdom', 'Isle of Man', 'Great Britain', 'Denmark', 'Sweden',
        'Iceland', 'Germany', 'Finland', 'Austria', 'Hungary', 'Czech Republic',
        'Bulgaria', 'Portugal', 'Italy', 'Greece', 'France', 'Spain',
        'Netherlands', 'Belgium', 'Norway', 'Poland', 'Romania', 'Japan',
        'Argentina', 'Unknown',
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
        'Portable Antiquities Scheme',
        'Historisk Museer ved Universitetet i Bergen',
        'Arkæologi Viborg',
      ],
    },
  ],
}

export function ARIADNESearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={ARIADNE_CONFIG} />
}
