import { STORAGE_KEYS } from '../config/storageKeys'

/**
 * notesStore — per-record human annotations ("gold standard" notes).
 *
 * Notes are keyed by `${nodeId}::${recordId}`, i.e. scoped to the node that
 * AUTHORED them. Downstream nodes inherit a note via the `_note` field that the
 * authoring node injects into the records it passes through, so sharing is
 * forward-only and parallel branches stay isolated (the edges do the scoping).
 *
 * In-memory only — notes belong to the workflow, not the browser. They are
 * exported into / imported from the workflow JSON on save / load (see
 * exportNotes / importNotes). The canvas itself is not persisted across a
 * reload, so neither are notes.
 *
 * Reactivity: call subscribeNotes() to be notified on any change. Consumers use
 * this to bump a version counter and re-resolve notes.
 */

// One-time cleanup of the legacy global-by-recordId persisted notes. The old
// implementation wrote these to localStorage and re-hydrated them across
// sessions; that behaviour is intentionally gone.
try { localStorage.removeItem(STORAGE_KEYS.NOTES_LEGACY) } catch {}

const _notes = new Map<string, string>()
const _listeners = new Set<() => void>()

function noteKey(nodeId: string, recordId: string): string {
  return `${nodeId}::${recordId}`
}

function _notify() {
  _listeners.forEach(fn => fn())
}

/** Set (or, with empty text, delete) the note authored at `nodeId` for `recordId`. */
export function setNote(nodeId: string, recordId: string, text: string): void {
  const key = noteKey(nodeId, recordId)
  const trimmed = text.trim()
  if (trimmed) {
    _notes.set(key, trimmed)
  } else {
    _notes.delete(key)
  }
  _notify()
}

/** The note authored at `nodeId` for `recordId`, if any. */
export function getNote(nodeId: string, recordId: string): string | undefined {
  return _notes.get(noteKey(nodeId, recordId))
}

/** Dump all notes as a plain object (for embedding in a saved workflow). */
export function exportNotes(): Record<string, string> {
  return Object.fromEntries(_notes)
}

/** Replace all notes from a saved workflow blob. */
export function importNotes(obj: Record<string, string> | undefined): void {
  _notes.clear()
  if (obj) {
    for (const [k, v] of Object.entries(obj)) {
      if (v) _notes.set(k, v)
    }
  }
  _notify()
}

/** Wipe every note (wired to the toolbar "Clear notes" control). */
export function clearAllNotes(): void {
  _notes.clear()
  _notify()
}

/** Subscribe to any note change. Returns an unsubscribe function. */
export function subscribeNotes(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}
