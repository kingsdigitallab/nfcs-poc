// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { EventEmitter } from 'events'
import {
  writeExample, deleteExample, rebuildManifest, exampleAuthoringMiddleware, ExampleError,
} from '../../server/examples.mjs'

/**
 * server/examples.mjs is the ONE implementation behind POST /dev/write-example
 * and /dev/delete-example (Vite dev + Express prod). These tests pin: the file
 * written, the manifest regenerated from disk after every write/delete, the
 * ungrouped-first / group / title ordering the accordion relies on, and the
 * slug guard (the only path construction in the module).
 */

const wf = { nodes: [{ id: 'a' }], edges: [] }
let dir: string

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'nfcs-examples-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const manifest = () => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))

describe('writeExample', () => {
  it('writes <slug>.json with title/description/group and rebuilds the manifest', () => {
    writeExample(dir, { slug: 'stonehenge', title: ' Stonehenge ', description: 'd', group: ' Workshop ', workflow: wf })
    const file = JSON.parse(readFileSync(join(dir, 'stonehenge.json'), 'utf8'))
    expect(file).toMatchObject({ nodes: wf.nodes, title: 'Stonehenge', description: 'd', group: 'Workshop' })
    expect(manifest()).toEqual([{ slug: 'stonehenge', title: 'Stonehenge', description: 'd', group: 'Workshop' }])
  })

  it('omits group from the manifest when empty and overwrites on the same slug', () => {
    writeExample(dir, { slug: 'x', title: 'One', workflow: wf })
    writeExample(dir, { slug: 'x', title: 'Two', group: '', workflow: wf })
    expect(manifest()).toEqual([{ slug: 'x', title: 'Two', description: '' }])
  })

  it('rejects a bad slug, the manifest name, a missing title and a workflow without nodes', () => {
    expect(() => writeExample(dir, { slug: '../etc', title: 't', workflow: wf })).toThrow(ExampleError)
    expect(() => writeExample(dir, { slug: 'manifest', title: 't', workflow: wf })).toThrow(/slug/)
    expect(() => writeExample(dir, { slug: 'ok', title: '  ', workflow: wf })).toThrow(/title/)
    expect(() => writeExample(dir, { slug: 'ok', title: 't', workflow: { nodes: 'no' } as never })).toThrow(/nodes/)
    expect(existsSync(join(dir, 'ok.json'))).toBe(false)
  })
})

describe('rebuildManifest ordering', () => {
  it('lists ungrouped first, then groups alphabetically, titles within', () => {
    writeExample(dir, { slug: 'b', title: 'Beta',  group: 'Zed',   workflow: wf })
    writeExample(dir, { slug: 'a', title: 'Alpha', group: 'Zed',   workflow: wf })
    writeExample(dir, { slug: 'c', title: 'Gamma', group: 'Alpha', workflow: wf })
    writeExample(dir, { slug: 'u', title: 'Loose',                 workflow: wf })
    expect(manifest().map((m: { slug: string }) => m.slug)).toEqual(['u', 'c', 'a', 'b'])
  })

  it('skips malformed files and ignores manifest.json itself', () => {
    writeFileSync(join(dir, 'broken.json'), '{not json')
    writeExample(dir, { slug: 'good', title: 'Good', workflow: wf })
    expect(rebuildManifest(dir).map(m => m.slug)).toEqual(['good'])
  })
})

describe('deleteExample', () => {
  it('removes the file and rebuilds the manifest', () => {
    writeExample(dir, { slug: 'a', title: 'A', group: 'G', workflow: wf })
    writeExample(dir, { slug: 'b', title: 'B', group: 'G', workflow: wf })
    deleteExample(dir, 'a')
    expect(existsSync(join(dir, 'a.json'))).toBe(false)
    expect(manifest().map((m: { slug: string }) => m.slug)).toEqual(['b'])
  })

  it('404s on an unknown slug and refuses a bad one', () => {
    let status = 0
    try { deleteExample(dir, 'nope') } catch (e) { status = (e as ExampleError).status }
    expect(status).toBe(404)
    expect(() => deleteExample(dir, 'a/b')).toThrow(/slug/)
    expect(() => deleteExample(dir, 'manifest')).toThrow(/slug/)
  })
})

// ── middleware: minimal connect-style req/res doubles ─────────────────────────

function call(mw: ReturnType<typeof exampleAuthoringMiddleware>, method: string, url: string, body?: unknown) {
  return new Promise<{ status: number; json: unknown; passed: boolean }>(resolve => {
    const req = Object.assign(new EventEmitter(), { method, url }) as EventEmitter & { method: string; url: string }
    let status = 200
    let out = ''
    const res = {
      setHeader() {},
      set statusCode(v: number) { status = v },
      get statusCode() { return status },
      end(s?: string) { out = s ?? ''; resolve({ status, json: out ? JSON.parse(out) : null, passed: false }) },
    }
    mw(req as never, res as never, () => resolve({ status: 0, json: null, passed: true }))
    if (body !== undefined) {
      queueMicrotask(() => { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') })
    }
  })
}

describe('exampleAuthoringMiddleware', () => {
  it('passes through anything that is not a POST to one of its two routes', async () => {
    const mw = exampleAuthoringMiddleware(dir)
    expect((await call(mw, 'GET', '/dev/write-example')).passed).toBe(true)
    expect((await call(mw, 'POST', '/examples/manifest.json')).passed).toBe(true)
  })

  it('writes then deletes through the HTTP shape the client uses', async () => {
    const mw = exampleAuthoringMiddleware(dir)
    const w = await call(mw, 'POST', '/dev/write-example', { slug: 's', title: 'S', group: 'G', workflow: wf })
    expect(w).toMatchObject({ status: 200, json: { saved: 's' } })
    expect(manifest()[0]).toMatchObject({ slug: 's', group: 'G' })
    const d = await call(mw, 'POST', '/dev/delete-example', { slug: 's' })
    expect(d).toMatchObject({ status: 200, json: { deleted: 's' } })
    expect(manifest()).toEqual([])
  })

  it('maps ExampleError status codes and reports bad JSON as 400', async () => {
    const mw = exampleAuthoringMiddleware(dir)
    const missing = await call(mw, 'POST', '/dev/delete-example', { slug: 'ghost' })
    expect(missing.status).toBe(404)
    expect(missing.json).toMatchObject({ error: expect.stringContaining('ghost') })
    const bad = await call(mw, 'POST', '/dev/write-example', { slug: 'bad/slug', title: 't', workflow: wf })
    expect(bad.status).toBe(400)
  })
})
