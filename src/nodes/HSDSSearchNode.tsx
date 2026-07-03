/**
 * HSDS (Heritage Science Data Service) search node — thin config over
 * BackboneSearchNode (the shared ARIADNE-backbone shell). Handle
 * ids/positions live in the shell.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
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

const HSDS_CONFIG: BackboneSearchConfig = {
  nodeType: 'hsdsSearch',
  title:    'HSDS Search',
  theme: {
    header:       '#134e4a',  // teal-900 — heritage data service
    runBtn:       '#0f3d3a',
    accentBg:     '#ccfbf1',
    accentBorder: '#99f6e4',
    sectionBg:    '#f0fdfa',
    clearBtn:     '#0f3d3a',
    fixtureIcon:  '#134e4a',
  },
  sortOptions: [
    { value: '_score',   label: 'Relevance' },
    { value: 'title',    label: 'Title' },
    { value: 'issued',   label: 'Date issued' },
    { value: 'modified', label: 'Last modified' },
  ],
  resourceTypeOptions: [
    '', 'Site/monument', 'Artefact', 'Coin', 'Fieldwork', 'Fieldwork report',
    'Maritime', 'Monument', 'Inscription', 'Date', 'Fieldwork archive',
    'Rock Art', 'Building survey', 'E-Publication', 'Scientific analysis',
    'Not provided', 'Burial',
  ],
  dataTypeOptions: [
    '', 'Structured Data', 'Still Image', 'Text', 'Geospatial',
    'CAD', 'Numeric', '3D', 'Video', 'Other', 'Audio', 'Software',
  ],
  countryOptions: [
    '', 'England', 'Scotland', 'Wales', 'Northern Ireland',
    'United Kingdom', 'Isle of Man', 'Great Britain', 'Ireland',
    'Republic of Ireland', 'Channel Islands',
  ],
  temporalOptions: [
    '', 'post medieval', 'roman', 'medieval', '19th century', 'bronze age',
    '20th century', 'early medieval', 'iron age', 'neolithic', 'prehistoric',
    'second world war', 'mesolithic', 'modern', '18th century',
    'later prehistoric', 'unknown', 'palaeolithic', 'late iron age',
    'early bronze age', 'late bronze age',
  ],
  contributorOptions: [
    '', 'Archaeology Data Service', 'Historic England',
    'Portable Antiquities Scheme', 'Historic Environment Scotland',
    'Cadw', 'Historic Environment Wales',
  ],
  derivedSubjectSuggestions: [
    'archaeological sites', 'earthworks (engineering works)', 'monuments',
    'buildings (structures)', 'ditches', 'enclosures', 'field systems',
    'farmsteads', 'churches', 'castles', 'roads', 'bridges',
    'industrial sites', 'burial mounds', 'hillforts',
  ],
  nativeSubjectSuggestions: [
    'site', 'building', 'monument', 'find', 'findspot', 'earthwork',
    'enclosure', 'ditch', 'field system', 'farmstead', 'henge',
    'stone circle', 'burial mound', 'hillfort', 'church', 'castle',
  ],
  derivedPlaceholder: 'e.g. hillforts',
  nativePlaceholder:  'e.g. henge',
}

export function HSDSSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={HSDS_CONFIG} />
}
