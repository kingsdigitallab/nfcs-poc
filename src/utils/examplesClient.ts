/**
 * examplesClient.ts — the client side of example-workflow authoring.
 *
 * One manifest cache for the Examples menu AND the Save-as-Example dialog
 * (which suggests existing group names), invalidated after every save or
 * delete so the menu reflects the change without a page reload. The server
 * half is server/examples.mjs (POST /dev/write-example, /dev/delete-example).
 */

import type { WorkflowFile } from './workflowIO'

export interface ExampleMeta {
  slug:        string
  title:       string
  description: string
  /** Accordion section in the Examples menu; absent/'' = ungrouped (flat list at the top). */
  group?:      string
}

export interface ExampleGroup { name: string; items: ExampleMeta[] }

let _cache: ExampleMeta[] | null = null
let _inflight: Promise<ExampleMeta[]> | null = null

/** Fetch /examples/manifest.json once per page load (or again after `invalidateExamplesManifest`). */
export function fetchExamplesManifest(force = false): Promise<ExampleMeta[]> {
  if (!force && _cache) return Promise.resolve(_cache)
  if (!force && _inflight) return _inflight
  _inflight = fetch('/examples/manifest.json')
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then((m: ExampleMeta[]) => { _cache = m; return m })
    .finally(() => { _inflight = null })
  return _inflight
}

export function invalidateExamplesManifest(): void { _cache = null }

/** Title → file slug: lower-case, runs of non-alphanumerics become one hyphen, trimmed. */
export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Ungrouped examples keep their manifest order; groups are listed in first-seen
 * order (the manifest is already sorted ungrouped → group → title by the server).
 */
export function groupExamples(list: ExampleMeta[]): { ungrouped: ExampleMeta[]; groups: ExampleGroup[] } {
  const ungrouped: ExampleMeta[] = []
  const byName = new Map<string, ExampleMeta[]>()
  for (const ex of list) {
    const g = ex.group?.trim()
    if (!g) { ungrouped.push(ex); continue }
    const items = byName.get(g) ?? []
    items.push(ex)
    byName.set(g, items)
  }
  return { ungrouped, groups: [...byName].map(([name, items]) => ({ name, items })) }
}

async function post(url: string, body: unknown): Promise<void> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) {
    const text = await r.text()
    let msg = text
    try { msg = String((JSON.parse(text) as { error?: string }).error ?? text) } catch { /* plain text body */ }
    throw new Error(msg || `HTTP ${r.status}`)
  }
}

export async function saveExample(body: {
  slug: string; title: string; description: string; group: string; workflow: WorkflowFile
}): Promise<void> {
  await post('/dev/write-example', body)
  invalidateExamplesManifest()
}

export async function deleteExample(slug: string): Promise<void> {
  await post('/dev/delete-example', { slug })
  invalidateExamplesManifest()
}
