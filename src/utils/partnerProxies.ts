/**
 * Client-side mirror of the hosts in server/proxies.mjs PROXY_TABLE that the
 * browser may need to reach for secondary resources (IIIF manifests, record
 * pages). Those routes send the User-Agent/Referer the partner expects —
 * SMG's CloudFront 403s the generic /url-proxy bot UA — so a fetch to one of
 * these hosts should go through its own prefix before falling back.
 */
const PARTNER_HOSTS: Record<string, string> = {
  'collection.sciencemuseumgroup.org.uk': '/smg-proxy',
  'api.vam.ac.uk':                        '/vam-proxy',
  'digital.bodleian.ox.ac.uk':            '/bodleian-proxy',
  'hsds.ac.uk':                           '/hsds-proxy',
  'museumdata.uk':                        '/mds-proxy',
  'api.gbif.org':                         '/gbif-proxy',
  'bnb.data.bl.uk':                       '/bnb-proxy',
}

/** Same-origin proxy URL for a known partner host, or null when none is wired. */
export function partnerProxyUrl(url: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  const prefix = PARTNER_HOSTS[u.hostname.toLowerCase()]
  return prefix ? `${prefix}${u.pathname}${u.search}` : null
}
