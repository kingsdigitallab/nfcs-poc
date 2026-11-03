import { describe, it, expect } from 'vitest'
import { adaptSMGRecord } from '../utils/runSMGSearchNode'

// Shapes taken from the live Collections Online API (co53933 has no multimedia,
// co49346 has one processed image). SMG publishes a IIIF manifest URL for every
// object, but the manifest is EMPTY (canvases: []) when there is no media.
const base = {
  type: 'objects',
  attributes: {
    title:       [{ type: 'catalogue title', value: 'Coloured drawing of Chang Heng seismoscope', primary: true }],
    description: [{ type: 'catalogue description', value: 'Coloured drawing', primary: true }],
    identifier:  [{ type: 'accession number', value: '1910-121', primary: true }],
    category:    [{ museum: 'SCM', name: 'Geophysics' }],
  },
  links: { self: 'https://collection.sciencemuseumgroup.org.uk/objects/co53933/x' },
}

describe('adaptSMGRecord — smg.manifest only when the object has digitised media', () => {
  it('omits smg.manifest for an object with no multimedia', () => {
    const out = adaptSMGRecord({ ...base, id: 'co53933' }) as Record<string, unknown>
    const smg = out.smg as Record<string, unknown>
    expect(smg.thumbnail).toBeUndefined()
    expect(smg.manifest).toBeUndefined()
  })

  it('keeps smg.manifest and smg.thumbnail for an object with a processed image', () => {
    const raw = {
      ...base, id: 'co49346',
      attributes: {
        ...base.attributes,
        multimedia: [{ '@processed': { large_thumbnail: { location: '534/648/large_thumbnail_smg00222466.jpg' } } }],
      },
    }
    const smg = (adaptSMGRecord(raw) as Record<string, unknown>).smg as Record<string, unknown>
    expect(smg.thumbnail).toBe('https://coimages.sciencemuseumgroup.org.uk/534/648/large_thumbnail_smg00222466.jpg')
    expect(smg.manifest).toBe('https://collection.sciencemuseumgroup.org.uk/iiif/objects/co49346')
  })
})
