import { describe, it, expect } from 'vitest'
import { adaptEuropeanaResponse, type EuropeanaItem } from '../utils/europeanaAdapter'

/**
 * Europeana's search API returns `guid` as the item page URL with the caller's
 * API key appended as a tracking parameter:
 *   https://www.europeana.eu/item/…?utm_source=api&utm_medium=api&utm_campaign=<wskey>
 * Copying that verbatim into `_sourceUrl` leaks the key into every saved
 * search, export and fixture. The adapter must strip it.
 */
const item: EuropeanaItem = {
  id: '/2048047/abc',
  guid: 'https://www.europeana.eu/item/2048047/abc?utm_source=api&utm_medium=api&utm_campaign=SECRETKEY',
  title: ['A title'],
}

describe('adaptEuropeanaResponse', () => {
  it('strips the API key tracking parameters from the item URL', () => {
    const [rec] = adaptEuropeanaResponse([item])
    expect(rec._sourceUrl).toBe('https://www.europeana.eu/item/2048047/abc')
    expect(JSON.stringify(rec)).not.toContain('SECRETKEY')
    expect(JSON.stringify(rec)).not.toContain('utm_campaign')
  })

  it('keeps a guid without tracking parameters unchanged and tolerates a missing guid', () => {
    expect(adaptEuropeanaResponse([{ ...item, guid: 'https://www.europeana.eu/item/1/x' }])[0]._sourceUrl)
      .toBe('https://www.europeana.eu/item/1/x')
    expect(adaptEuropeanaResponse([{ ...item, guid: undefined }])[0]._sourceUrl).toBeUndefined()
  })
})
