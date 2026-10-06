import { describe, it, expect, vi } from 'vitest'

vi.mock('node:dns/promises', () => {
  const lookup = vi.fn(async (host: string) =>
    host === 'private.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }])
  return { lookup, default: { lookup } }
})

import { lookup } from 'node:dns/promises'
import { checkSubresource } from '../../server/proxies.mjs'

describe('checkSubresource (what a rendered page may load)', () => {
  it('refuses private hosts and names resolving to private addresses, allows public ones', async () => {
    const memo = new Map()
    expect((await checkSubresource('http://10.0.0.1/x', memo)).ok).toBe(false)
    expect((await checkSubresource('https://private.example/x', memo)).ok).toBe(false)
    expect((await checkSubresource('https://cdn.example/lib.js', memo)).ok).toBe(true)
    expect((await checkSubresource('ftp://cdn.example/lib.js', memo)).ok).toBe(false)
  })

  it('resolves each host once per render when given a memo', async () => {
    vi.mocked(lookup).mockClear()
    const memo = new Map()
    await Promise.all([
      checkSubresource('https://cdn.example/a.js', memo),
      checkSubresource('https://cdn.example/b.js', memo),
      checkSubresource('https://cdn.example/c.css', memo),
      checkSubresource('https://other.example/d.js', memo),
    ])
    const hosts = vi.mocked(lookup).mock.calls.map(c => c[0])
    expect(hosts.sort()).toEqual(['cdn.example', 'other.example'])
  })
})
