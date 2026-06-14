/**
 * Format a millisecond duration for display in node status messages and output nodes.
 *
 * Examples:
 *   420   → "420ms"
 *   8400  → "8.4s"
 *   63500 → "1m 03s"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) {
    const s = ms / 1000
    // One decimal place, but strip trailing ".0"
    const str = s.toFixed(1)
    return str.endsWith('.0') ? `${Math.round(s)}s` : `${str}s`
  }
  const m  = Math.floor(ms / 60_000)
  const s  = Math.round((ms % 60_000) / 1000)
  return `${m}m ${String(s).padStart(2, '0')}s`
}
