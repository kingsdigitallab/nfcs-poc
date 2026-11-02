/**
 * Dot-notation field access for UnifiedRecord-shaped objects.
 *
 * `getFieldByPath(r, 'europeana.thumbnail')` walks namespaced sub-objects one key
 * at a time. The same resolver was previously re-implemented inside ImageViewNode,
 * TimelineOutputNode, SmartFilterNode and SourceProfileNode; new code should import
 * this one.
 */
export function getFieldByPath(record: unknown, path: string): unknown {
  if (!path || record == null || typeof record !== 'object') return undefined
  let cur: unknown = record
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

/** True for a string with at least one non-whitespace character. */
export function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
