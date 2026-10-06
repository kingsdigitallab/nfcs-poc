import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Shipped example workflows are authored from a live canvas, so any field
 * the save path fails to strip ends up committed. This is the regression
 * guard for the apiKey leak: no node in public/examples may carry a key.
 */
const EXAMPLES_DIR = join(process.cwd(), 'public', 'examples')
const KEY_PATTERN = /^sk-[A-Za-z0-9]{8,}/

describe('public/examples contain no credentials', () => {
  const files = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith('.json') && f !== 'manifest.json')

  it('has at least one example to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} has no apiKey values`, () => {
      const parsed = JSON.parse(readFileSync(join(EXAMPLES_DIR, file), 'utf8')) as {
        nodes?: { id: string; data?: Record<string, unknown> }[]
      }
      const offenders = (parsed.nodes ?? [])
        .filter(n => typeof n.data?.apiKey === 'string' && KEY_PATTERN.test(n.data.apiKey as string))
        .map(n => n.id)
      expect(offenders).toEqual([])
    })

    it(`${file} contains no sk-… key anywhere (Param values, prompts, notes)`, () => {
      const raw = readFileSync(join(EXAMPLES_DIR, file), 'utf8')
      expect(raw.match(/sk-[A-Za-z0-9_-]{16,}/g) ?? []).toEqual([])
    })
  }
})
