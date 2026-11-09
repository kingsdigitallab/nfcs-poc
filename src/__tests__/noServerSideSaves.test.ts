import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

/**
 * The app must never persist or log user content or client identifiers on
 * the server. From May to Nov 2026 every 💾 Save was also POSTed to
 * `/api/save-workflow`, which wrote the workflow to a Docker volume together
 * with the caller's IP address — with no notice, retention or authentication.
 * It was removed in Nov 2026 after a data-protection review
 * (docs/engineering-review.md S4). This test fails if any of it comes back:
 *
 *   1. no source file under src/ or server/ mentions the old endpoint or reads
 *      a client address (`remoteIp`, `remoteAddress`, `x-forwarded-for`);
 *   2. docker-compose.yml mounts no data volume into the app (`:/app/data`).
 *
 * The strings are assembled at runtime so this file does not match itself.
 */
const ROOT = process.cwd()
const SCAN_DIRS = ['src', 'server']
const SELF = join(ROOT, 'src', '__tests__', 'noServerSideSaves.test.ts')

const FORBIDDEN: readonly string[] = [
  ['save', 'workflow'].join('-'),            // the removed endpoint path
  ['remote', 'Ip'].join(''),                 // the stored field
  ['remote', 'Address'].join(''),            // req.socket.<…>
  ['x', 'forwarded', 'for'].join('-'),       // the proxy header
]

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue
      out.push(...sourceFiles(p))
    } else if (/\.(ts|tsx|mjs|js|sh)$/.test(e.name) && p !== SELF) {
      out.push(p)
    }
  }
  return out
}

describe('no server-side persistence of user content or client identifiers', () => {
  const files = SCAN_DIRS.flatMap(d => sourceFiles(join(ROOT, d)))

  it('scans a plausible number of source files', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('no source file references the removed save endpoint or a client address', () => {
    const offenders: string[] = []
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      for (const needle of FORBIDDEN) {
        if (text.includes(needle)) offenders.push(`${relative(ROOT, f)}: ${needle}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('docker-compose.yml mounts no data volume into the app', () => {
    const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8')
    const mounts = compose.split('\n').filter(l => /^\s*-\s+\S+:\/app\/data(\/|:|\s|$)/.test(l))
    expect(mounts).toEqual([])
  })
})
