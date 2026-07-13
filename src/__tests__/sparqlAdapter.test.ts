import { describe, it, expect } from 'vitest'
import { adaptSparqlResults, type SparqlResultsJson } from '../utils/sparqlAdapter'

const sample: SparqlResultsJson = {
  head: { vars: ['item', 'itemLabel', 'itemDescription', 'coords', 'date', 'image'] },
  results: {
    bindings: [
      {
        item:            { type: 'uri', value: 'http://www.wikidata.org/entity/Q1231009' },
        itemLabel:       { type: 'literal', value: 'The Fighting Temeraire', 'xml:lang': 'en' },
        itemDescription: { type: 'literal', value: 'painting by J. M. W. Turner', 'xml:lang': 'en' },
        coords:          { type: 'literal', value: 'Point(-0.1281 51.5089)', datatype: 'http://www.opengis.net/ont/geosparql#wktLiteral' },
        date:            { type: 'literal', value: '1839-01-01T00:00:00Z', datatype: 'http://www.w3.org/2001/XMLSchema#dateTime' },
        image:           { type: 'uri', value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Temeraire.jpg' },
      },
      {
        item:      { type: 'uri', value: 'http://www.wikidata.org/entity/Q219477' },
        itemLabel: { type: 'literal', value: 'Rain, Steam and Speed', 'xml:lang': 'en' },
      },
      {
        // no item binding at all — e.g. an aggregate row
        count: { type: 'literal', value: '42', datatype: 'http://www.w3.org/2001/XMLSchema#integer' },
      },
    ],
  },
}

describe('adaptSparqlResults', () => {
  const records = adaptSparqlResults(sample)

  it('maps item/itemLabel/itemDescription to id/title/description', () => {
    expect(records).toHaveLength(3)
    expect(records[0].id).toBe('sparql:Q1231009-0')
    expect(records[0]._source).toBe('sparql')
    expect(records[0].title).toBe('The Fighting Temeraire')
    expect(records[0].description).toBe('painting by J. M. W. Turner')
    expect(records[0]._sourceUrl).toBe('http://www.wikidata.org/entity/Q1231009')
    expect(records[0]._pid).toBe('http://www.wikidata.org/entity/Q1231009')
  })

  it('extracts the plain _qid for WikidataEnrich / MergeByQID', () => {
    expect(records[0]._qid).toBe('Q1231009')
    expect(records[1]._qid).toBe('Q219477')
  })

  it('parses WKT Point(lon lat) into decimal coordinates', () => {
    expect(records[0].decimalLongitude).toBeCloseTo(-0.1281)
    expect(records[0].decimalLatitude).toBeCloseTo(51.5089)
    expect(records[1].decimalLatitude).toBeUndefined()
  })

  it('takes the date part of xsd:dateTime bindings', () => {
    expect(records[0].date).toBe('1839-01-01')
  })

  it('preserves every binding under the sparql namespace', () => {
    expect(records[0].sparql).toMatchObject({
      item: 'http://www.wikidata.org/entity/Q1231009',
      itemLabel: 'The Fighting Temeraire',
      coords: 'Point(-0.1281 51.5089)',
      image: 'http://commons.wikimedia.org/wiki/Special:FilePath/Temeraire.jpg',
    })
  })

  it('survives rows without an item binding (unique fallback ids, fallback title)', () => {
    expect(records[2].id).toBe('sparql:row-2')
    expect(records[2].title).toBe('SPARQL result 3')
    expect(records[2].sparql).toMatchObject({ count: '42' })
  })

  it('returns [] for an empty result set', () => {
    expect(adaptSparqlResults({})).toEqual([])
  })
})
