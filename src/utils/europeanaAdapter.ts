import type { UnifiedRecord } from '../types/UnifiedRecord'

export interface EuropeanaItem {
  id:                  string
  guid?:               string
  title?:              string[]
  dcCreator?:          string[]
  dcDescription?:      string[]
  dcSubject?:          string[]
  year?:               string[]
  type?:               string
  language?:           string[]
  country?:            string[]
  dataProvider?:       string[]
  provider?:           string[]
  rights?:             string[]
  edmIsShownAt?:       string[]
  edmPreview?:         string[]
  completeness?:       number
}

export interface EuropeanaSearchResponse {
  success:        boolean
  totalResults:   number
  itemsCount:     number
  items?:         EuropeanaItem[]
  nextCursor?:    string   // cursor-based pagination token; absent on last page
  error?:         string
}

export function adaptEuropeanaResponse(items: EuropeanaItem[]): UnifiedRecord[] {
  return items.map(item => {
    const creator = item.dcCreator && item.dcCreator.length > 0 ? item.dcCreator : undefined

    return {
      id:         `europeana:${item.id}`,
      _source:    'europeana',
      _sourceId:  item.id,
      _sourceUrl: item.guid,

      title:       item.title?.[0],
      creator,
      description: item.dcDescription?.[0],
      subject:     item.dcSubject,
      date:        item.year?.[0],
      type:        item.type,
      language:    item.language?.[0],
      country:     item.country,

      europeana: {
        provider:     item.provider,
        dataProvider: item.dataProvider,
        rights:       item.rights?.[0],
        thumbnail:    item.edmPreview?.[0],
        shownAt:      item.edmIsShownAt?.[0],
        completeness: item.completeness,
      },
    }
  })
}
