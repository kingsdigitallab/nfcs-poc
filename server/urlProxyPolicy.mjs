/**
 * server/urlProxyPolicy.mjs — pure allow/deny policy for the /url-proxy route.
 *
 * Kept free of Node-only imports so vitest can unit-test it directly
 * (src/__tests__/urlProxyPolicy.test.ts). DNS resolution and the actual
 * fetch live in proxies.mjs; this module only answers "may this URL be
 * fetched on behalf of a browser client?".
 *
 * Policy:
 *   1. http/https only; no credentials in the URL.
 *   2. Private, loopback, link-local and metadata addresses are ALWAYS denied,
 *      including when allowAll is set — the proxy must never reach the Docker
 *      network (ollama:11434) or cloud metadata (169.254.169.254).
 *   3. Otherwise the host must match the allowlist exactly or as a dot-suffix
 *      (allowlist 'ac.uk' admits 'archaeologydataservice.ac.uk'), unless
 *      allowAll is set (dev default — see proxies.mjs for how that is chosen).
 */

/** Puppeteer waitUntil values the proxy accepts for ?wait= */
export const WAIT_STRATEGIES = new Set(['networkidle2', 'networkidle0', 'domcontentloaded', 'load'])

/** Hard cap on a proxied response body. */
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/** 'a.org, B.ac.uk' → ['a.org', 'b.ac.uk'] */
export function parseAllowlist(envValue) {
  if (!envValue) return []
  return String(envValue)
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every(p => p <= 255) ? parts : null
}

function isPrivateIPv4(parts) {
  const [a, b] = parts
  if (a === 10) return true                       // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16/12
  if (a === 192 && b === 168) return true          // 192.168/16
  if (a === 127) return true                       // loopback
  if (a === 169 && b === 254) return true          // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64/10 carrier-grade NAT
  if (a === 0) return true                         // 0.0.0.0/8
  return false
}

/** Last two 16-bit groups of an IPv6 address → IPv4 octets (for ::ffff:x:y and 64:ff9b::x:y). */
function v4FromTrailingGroups(h, prefix) {
  const m = new RegExp(`^${prefix}([0-9a-f]{1,4}):([0-9a-f]{1,4})$`).exec(h)
  if (!m) return null
  const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16)
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]
}

function isPrivateIPv6(host) {
  const h = host.toLowerCase()
  if (h === '::' || h === '::1') return true
  // IPv4-mapped (::ffff:a.b.c.d) — note `new URL()` normalises the dotted
  // form to hex groups (::ffff:7f00:1), so both spellings must be handled.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h)
  if (mapped) {
    const v4 = parseIPv4(mapped[1])
    return v4 ? isPrivateIPv4(v4) : true
  }
  const mappedHex = v4FromTrailingGroups(h, '::ffff:')
  if (mappedHex) return isPrivateIPv4(mappedHex)
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address the same way
  const nat64 = v4FromTrailingGroups(h, '64:ff9b::')
  if (nat64) return isPrivateIPv4(nat64)
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true   // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true   // fe80::/10 link-local
  return false
}

/**
 * True for any hostname or literal address that must never be proxied.
 * Accepts the bracket-free form `new URL(...).hostname` yields for IPv6.
 */
export function isPrivateHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.internal')) return true
  const v4 = parseIPv4(h)
  if (v4) return isPrivateIPv4(v4)
  if (h.includes(':')) return isPrivateIPv6(h)
  return false
}

/**
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function isAllowedTarget(urlString, allowlist, { allowAll = false } = {}) {
  let url
  try {
    url = new URL(String(urlString))
  } catch {
    return { ok: false, reason: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Scheme not allowed: ${url.protocol}` }
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Credentials in URL are not allowed' }
  }
  const host = url.hostname.toLowerCase()
  if (isPrivateHost(host)) {
    return { ok: false, reason: `Private or local address not allowed: ${host}` }
  }
  if (allowAll) return { ok: true, url }
  const list = Array.isArray(allowlist) ? allowlist : []
  const matched = list.some(entry => host === entry || host.endsWith('.' + entry))
  if (!matched) {
    return { ok: false, reason: `Host not in URL_PROXY_ALLOWLIST: ${host}` }
  }
  return { ok: true, url }
}
