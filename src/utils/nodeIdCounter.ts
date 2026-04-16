let _counter = 1

export function newId(prefix: string): string {
  return `${prefix}-${_counter++}`
}

/** Call after loading a saved workflow to prevent ID collisions. */
export function bumpCounterPast(ids: string[]): void {
  for (const id of ids) {
    const m = id.match(/-(\d+)$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= _counter) _counter = n + 1
    }
  }
}
