/**
 * notesStore — per-record human annotations ("gold standard" notes).
 *
 * Notes are keyed by record ID (e.g. "gbif:12345") which is stable across
 * re-runs of the same query. Persisted to localStorage so they survive refresh.
 *
 * Reactivity: call subscribeNotes() to be notified on any change.
 * TableOutputNode uses this to bump a version counter and re-inject _note
 * into effectiveRecords before writing to the results store.
 */

const STORAGE_KEY = 'nfcs_notes'

const _notes = new Map<string, string>()
const _listeners = new Set<() => void>()

// Hydrate from localStorage on module load
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, string>
    for (const [k, v] of Object.entries(parsed)) {
      if (v) _notes.set(k, v)
    }
  }
} catch {}

function _persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(_notes)))
  } catch {}
}

function _notify() {
  _listeners.forEach(fn => fn())
}

export function setNote(recordId: string, text: string): void {
  const trimmed = text.trim()
  if (trimmed) {
    _notes.set(recordId, trimmed)
  } else {
    _notes.delete(recordId)
  }
  _persist()
  _notify()
}

export function getNote(recordId: string): string | undefined {
  return _notes.get(recordId)
}

export function getAllNotes(): Record<string, string> {
  return Object.fromEntries(_notes)
}

export function deleteNote(recordId: string): void {
  _notes.delete(recordId)
  _persist()
  _notify()
}

export function clearAllNotes(): void {
  _notes.clear()
  _persist()
  _notify()
}

/** Subscribe to any note change. Returns an unsubscribe function. */
export function subscribeNotes(fn: () => void): () => void {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}
