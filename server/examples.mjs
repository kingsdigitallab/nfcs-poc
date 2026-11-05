/**
 * server/examples.mjs — example-workflow authoring (write / delete / manifest).
 *
 * Plain ESM so Node runs it in-container without a build step, like
 * proxies.mjs. ONE implementation shared by the Vite dev server
 * (vite.config.ts, always on) and the Express prod server (server/index.mjs,
 * only when ENABLE_EXAMPLE_AUTHORING=true — the endpoints are unauthenticated
 * file writes into the examples directory).
 *
 *   POST /dev/write-example   { slug, title, description?, group?, workflow }
 *   POST /dev/delete-example  { slug }
 *
 * Both regenerate manifest.json from the directory afterwards, so the
 * manifest is always a function of the files on disk. An example file is the
 * saved workflow plus `title`, `description` and `group` (optional — the
 * accordion section the Examples menu files it under; '' = ungrouped).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const SLUG_RE = /^[\w-]+$/
const BODY_LIMIT = 10 * 1024 * 1024

/** Thrown by writeExample/deleteExample; `status` becomes the HTTP status. */
export class ExampleError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new ExampleError(400, 'Invalid slug')
  if (slug === 'manifest') throw new ExampleError(400, 'Invalid slug')
}

/** Read every example file and rewrite manifest.json. Returns the manifest. */
export function rebuildManifest(dir) {
  mkdirSync(dir, { recursive: true })
  const manifest = []
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'manifest.json')) {
    try {
      const parsed = JSON.parse(String(readFileSync(join(dir, f))))
      const slug = f.replace(/\.json$/, '')
      const group = typeof parsed.group === 'string' ? parsed.group.trim() : ''
      const entry = { slug, title: String(parsed.title ?? slug), description: String(parsed.description ?? '') }
      if (group) entry.group = group
      manifest.push(entry)
    } catch { /* skip malformed files */ }
  }
  // Ungrouped first, then groups alphabetically, titles within each
  manifest.sort((a, b) =>
    (a.group ?? '').localeCompare(b.group ?? '') || a.title.localeCompare(b.title))
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return manifest
}

/** Write <slug>.json (overwriting) and rebuild the manifest. */
export function writeExample(dir, { slug, title, description, group, workflow }) {
  assertSlug(slug)
  if (!title || typeof title !== 'string' || !title.trim()) throw new ExampleError(400, 'title is required')
  if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
    throw new ExampleError(400, 'workflow must be a valid workflow object with a nodes array')
  }
  mkdirSync(dir, { recursive: true })
  const payload = {
    ...workflow,
    title:       title.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    group:       typeof group === 'string' ? group.trim() : '',
  }
  writeFileSync(join(dir, `${slug}.json`), JSON.stringify(payload, null, 2))
  rebuildManifest(dir)
  return slug
}

/** Remove <slug>.json and rebuild the manifest. 404 when it does not exist. */
export function deleteExample(dir, slug) {
  assertSlug(slug)
  const file = join(dir, `${slug}.json`)
  if (!existsSync(file)) throw new ExampleError(404, `No example "${slug}"`)
  unlinkSync(file)
  rebuildManifest(dir)
  return slug
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
      if (body.length > BODY_LIMIT) { reject(new ExampleError(413, 'Body too large')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) } catch (e) { reject(new ExampleError(400, `Invalid JSON: ${e}`)) }
    })
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

/**
 * Connect-style middleware serving both endpoints against `dir`. Parses the
 * body itself so Vite (no body parser) and Express (without express.json)
 * behave identically.
 */
export function exampleAuthoringMiddleware(dir) {
  return function examplesMiddleware(req, res, next) {
    const url = req.url ?? ''
    const isWrite  = url.startsWith('/dev/write-example')
    const isDelete = url.startsWith('/dev/delete-example')
    if (req.method !== 'POST' || !(isWrite || isDelete)) { next(); return }
    readJsonBody(req)
      .then(body => {
        if (isWrite) {
          const slug = writeExample(dir, body ?? {})
          console.log(`[example] Saved: ${slug}`)
          send(res, 200, { saved: slug })
        } else {
          const slug = deleteExample(dir, body?.slug)
          console.log(`[example] Deleted: ${slug}`)
          send(res, 200, { deleted: slug })
        }
      })
      .catch(e => {
        const status = e instanceof ExampleError ? e.status : 500
        send(res, status, { error: e instanceof Error ? e.message : String(e) })
      })
  }
}
