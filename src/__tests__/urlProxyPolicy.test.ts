import { describe, it, expect } from 'vitest'
import {
  parseAllowlist,
  isPrivateHost,
  isAllowedTarget,
  WAIT_STRATEGIES,
  MAX_RESPONSE_BYTES,
} from '../../server/urlProxyPolicy.mjs'

describe('parseAllowlist', () => {
  it('splits a comma list, trims whitespace, lowercases, drops empties', () => {
    expect(parseAllowlist(' Example.org, api.ac.uk ,, ')).toEqual(['example.org', 'api.ac.uk'])
  })
  it('returns [] for undefined or empty input', () => {
    expect(parseAllowlist(undefined)).toEqual([])
    expect(parseAllowlist('')).toEqual([])
  })
})

describe('isPrivateHost', () => {
  it.each([
    '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.254',
    '192.168.1.1',
    '127.0.0.1', '127.255.0.9',
    '169.254.169.254',
    '0.0.0.0',
    '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3',
    'localhost', 'foo.localhost', 'ollama.internal',
  ])('treats %s as private', host => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each([
    '::ffff:7f00:1',        // 127.0.0.1 in the hex-mapped form WHATWG URL produces
    '::ffff:a9fe:a9fe',     // 169.254.169.254
    '::ffff:ac11:2',        // 172.17.0.2 (Docker bridge)
    '64:ff9b::7f00:1',      // NAT64 well-known prefix
    '100.64.0.1', '100.127.255.254', // CGNAT 100.64/10
  ])('treats %s (alternative private encodings) as private', host => {
    expect(isPrivateHost(host)).toBe(true)
  })

  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '193.60.1.1', '2001:db8::1', 'example.org', 'internal.example.org', '100.63.255.255', '100.128.0.1'])(
    'treats %s as public', host => {
      expect(isPrivateHost(host)).toBe(false)
    })
})

describe('isAllowedTarget', () => {
  const allow = ['example.org', 'ac.uk']

  it('rejects non-http(s) schemes', () => {
    expect(isAllowedTarget('ftp://example.org/x', allow).ok).toBe(false)
    expect(isAllowedTarget('javascript:alert(1)', allow).ok).toBe(false)
    expect(isAllowedTarget('file:///etc/passwd', allow).ok).toBe(false)
  })

  it('rejects unparseable URLs', () => {
    expect(isAllowedTarget('not a url', allow).ok).toBe(false)
    expect(isAllowedTarget('', allow).ok).toBe(false)
  })

  it('rejects credentials embedded in the URL', () => {
    expect(isAllowedTarget('https://user:pw@example.org/', allow).ok).toBe(false)
  })

  it('rejects private hosts even when allowAll is set', () => {
    expect(isAllowedTarget('http://169.254.169.254/latest', [], { allowAll: true }).ok).toBe(false)
    expect(isAllowedTarget('http://localhost:11434/api', [], { allowAll: true }).ok).toBe(false)
    expect(isAllowedTarget('http://[::1]/', [], { allowAll: true }).ok).toBe(false)
    // URL normalises the dotted mapped form to hex — the check must see through it
    expect(isAllowedTarget('http://[::ffff:127.0.0.1]/', [], { allowAll: true }).ok).toBe(false)
    expect(isAllowedTarget('http://[::ffff:169.254.169.254]/', [], { allowAll: true }).ok).toBe(false)
  })

  it('accepts exact and suffix allowlist matches, case-insensitively', () => {
    expect(isAllowedTarget('https://example.org/page', allow).ok).toBe(true)
    expect(isAllowedTarget('https://WWW.Example.org/page', allow).ok).toBe(true)
    expect(isAllowedTarget('https://archaeologydataservice.ac.uk/x', allow).ok).toBe(true)
  })

  it('does not match a host that merely ends with the allowlist text', () => {
    expect(isAllowedTarget('https://notexample.org/', allow).ok).toBe(false)
    expect(isAllowedTarget('https://example.org.evil.com/', allow).ok).toBe(false)
  })

  it('rejects everything public when the allowlist is empty and allowAll is false', () => {
    expect(isAllowedTarget('https://example.org/', []).ok).toBe(false)
  })

  it('accepts any public host when allowAll is set', () => {
    expect(isAllowedTarget('https://anything.example.net/', [], { allowAll: true }).ok).toBe(true)
  })

  it('returns a reason on denial and the parsed URL on success', () => {
    const denied = isAllowedTarget('http://10.0.0.1/', allow)
    expect(denied.ok).toBe(false)
    expect(denied.ok === false && denied.reason).toMatch(/private/i)
    const ok = isAllowedTarget('https://example.org/a?b=1', allow)
    expect(ok.ok === true && ok.url.hostname).toBe('example.org')
  })
})

describe('constants', () => {
  it('exposes the Puppeteer wait strategies the proxy accepts', () => {
    expect(WAIT_STRATEGIES.has('networkidle2')).toBe(true)
    expect(WAIT_STRATEGIES.has('domcontentloaded')).toBe(true)
    expect(WAIT_STRATEGIES.has('whatever')).toBe(false)
  })
  it('caps proxied responses at 10 MB', () => {
    expect(MAX_RESPONSE_BYTES).toBe(10 * 1024 * 1024)
  })
})
