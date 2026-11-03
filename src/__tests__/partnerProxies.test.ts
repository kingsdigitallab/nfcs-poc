import { describe, it, expect } from 'vitest'
import { partnerProxyUrl } from '../utils/partnerProxies'

describe('partnerProxyUrl', () => {
  it('rewrites known partner hosts onto their same-origin proxy prefix', () => {
    expect(partnerProxyUrl('https://collection.sciencemuseumgroup.org.uk/iiif/objects/co49346'))
      .toBe('/smg-proxy/iiif/objects/co49346')
    expect(partnerProxyUrl('https://api.vam.ac.uk/v2/objects/search?q=x'))
      .toBe('/vam-proxy/v2/objects/search?q=x')
    expect(partnerProxyUrl('https://digital.bodleian.ox.ac.uk/objects/abc/'))
      .toBe('/bodleian-proxy/objects/abc/')
  })
  it('returns null for hosts without a dedicated proxy', () => {
    expect(partnerProxyUrl('https://iiif.bodleian.ox.ac.uk/iiif/manifest/x.json')).toBeNull()
    expect(partnerProxyUrl('https://zoom.sciencemuseumgroup.org.uk/iiif/3/x')).toBeNull()
    expect(partnerProxyUrl('not a url')).toBeNull()
  })
})
