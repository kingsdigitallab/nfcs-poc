/**
 * ARIADNE portal search node — thin config over BackboneSearchNode (the
 * shared ARIADNE-backbone shell). Handle ids/positions live in the shell.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
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

const ARIADNE_CONFIG: BackboneSearchConfig = {
  nodeType: 'ariadneSearch',
  title:    'ARIADNE Search',
  theme: {
    header:       '#164e63',  // cyan-900 — distinct from all existing nodes
    runBtn:       '#0e7490',  // cyan-600
    accentBg:     '#ecfeff',
    accentBorder: '#a5f3fc',
    sectionBg:    '#f0fdff',
    clearBtn:     '#0e7490',
    fixtureIcon:  '#0e7490',
  },
  sortOptions: [
    { value: '_score', label: 'Relevance' },
    { value: 'title',  label: 'Title' },
    { value: 'issued', label: 'Date issued' },
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
    '', 'England', 'Scotland', 'Wales', 'Ireland', 'Northern Ireland',
    'United Kingdom', 'Isle of Man', 'Great Britain', 'Denmark', 'Sweden',
    'Iceland', 'Germany', 'Finland', 'Austria', 'Hungary', 'Czech Republic',
    'Bulgaria', 'Portugal', 'Italy', 'Greece', 'France', 'Spain',
    'Netherlands', 'Belgium', 'Norway', 'Poland', 'Romania', 'Japan',
    'Argentina', 'Unknown',
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
    'Portable Antiquities Scheme',
    'Historisk Museer ved Universitetet i Bergen',
    'Arkæologi Viborg',
  ],
  derivedSubjectSuggestions: [
    'early western world coins', 'houses', 'archaeological sites',
    'vessels (containers)', 'earthworks (engineering works)', 'buckles (strap accessories)',
    'brooches', 'penny coins', 'agricultural settlements', 'buildings (structures)',
    'wrecks (sites)', 'farms', 'ditches', 'pits (earthworks)', 'glass (material)',
    'windows', 'stained-glass windows', 'conservation (discipline)', 'boundaries',
    'coins (money)',
  ],
  nativeSubjectSuggestions: [
    'coin', 'geophysical survey', 'house', 'vessel', 'extant building',
    'findspot', 'buckle', 'site', 'brooch', 'building', 'wreck', 'earthwork',
    'penny', 'enclosure', 'find', 'pit', 'farmstead', 'ditch', 'field system',
    'cemetery',
  ],
  derivedPlaceholder: 'e.g. barrows',
  nativePlaceholder:  'e.g. bowl barrow',
}

export function ARIADNESearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={ARIADNE_CONFIG} />
}
