import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Shipped example workflows and fixtures are authored from a live canvas, so
 * any credential the save path fails to strip — or that an adapter copies
 * into a record — ends up committed. These tests are the regression guard:
 *
 *   1. no example node carries ANY apiKey value (not just the sk-… shape);
 *   2. no example or fixture carries Europeana's `utm_campaign=<wskey>`
 *      tracking parameter (the adapter strips it; see europeanaAdapter.test);
 *   3. no value configured in the local .env as VITE_*_API_KEY appears in any
 *      shipped file — vitest loads .env, so this catches a leak on the
 *      author's machine before it is committed (it is a no-op in CI).
 */
const EXAMPLES_DIR = join(process.cwd(), 'public', 'examples')
const FIXTURES_DIR = join(process.cwd(), 'public', 'fixtures')
// Boundary before `sk-` so slugs such as "desk-lamp-…" in fixture data do not match.
const KEY_PATTERN = /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/

function jsonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json') && !e.name.endsWith('manifest.json'))
    .map(e => e.name)
}

const configuredKeys = Object.entries(import.meta.env)
  .filter(([k, v]) => /^VITE_.*API_KEY$/.test(k) && typeof v === 'string' && v.length >= 6)
  .map(([k, v]) => [k, v as string] as const)

describe('public/examples contain no credentials', () => {
  const files = jsonFiles(EXAMPLES_DIR)

  it('has at least one example to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const raw = () => readFileSync(join(EXAMPLES_DIR, file), 'utf8')

    it(`${file}: no node carries an apiKey value`, () => {
      const parsed = JSON.parse(raw()) as { nodes?: { id: string; data?: Record<string, unknown> }[] }
      const offenders = (parsed.nodes ?? [])
        .filter(n => typeof n.data?.apiKey === 'string' && (n.data.apiKey as string).length > 0)
        .map(n => n.id)
      expect(offenders).toEqual([])
    })

    it(`${file}: contains no sk-… key or Europeana tracking key anywhere`, () => {
      expect(raw().match(KEY_PATTERN)).toBeNull()
      expect(raw()).not.toMatch(/utm_campaign=/)
    })

    it(`${file}: contains none of the locally configured API keys`, () => {
      for (const [name, value] of configuredKeys) {
        expect(raw().includes(value), `${name} value found in ${file}`).toBe(false)
      }
    })
  }
})

describe('public/fixtures contain no credentials', () => {
  const files = jsonFiles(FIXTURES_DIR)

  it('has fixtures to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('no fixture carries a Europeana tracking key or sk-… key', () => {
    const offenders = files.filter(f => {
      const raw = readFileSync(join(FIXTURES_DIR, f), 'utf8')
      return /utm_campaign=/.test(raw) || KEY_PATTERN.test(raw)
    })
    expect(offenders).toEqual([])
  })

  it('no fixture contains a locally configured API key', () => {
    const offenders: string[] = []
    for (const f of files) {
      const raw = readFileSync(join(FIXTURES_DIR, f), 'utf8')
      for (const [name, value] of configuredKeys) {
        if (raw.includes(value)) offenders.push(`${f} (${name})`)
      }
    }
    expect(offenders).toEqual([])
  })
})
