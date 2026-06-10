/**
 * useStaleResults — detects when a node's stored results are out of date
 * because its configuration has changed since the last successful run.
 *
 * Returns true when:
 *   - The node's current status is 'success'
 *   - At least one successful run has completed during this component lifetime
 *   - The config fingerprint has changed since that run completed
 *
 * The stale flag resets to false the moment a new run begins (status leaves
 * 'success') and stays false until the next run completes and config diverges.
 */
import { useRef } from 'react'

export function useStaleResults(
  status: string,
  configFields: Record<string, unknown>,
): boolean {
  const lastRunKey = useRef<string | null>(null)
  const prevStatus = useRef<string>(status)

  const currentKey = JSON.stringify(configFields)

  // Capture the config at the moment a run transitions INTO a terminal success.
  // We do this inline (not in useEffect) so the comparison is always current.
  const wasRunning   = prevStatus.current === 'running'
  const nowSuccess   = status === 'success'
  if (wasRunning && nowSuccess) {
    lastRunKey.current = currentKey
  }
  prevStatus.current = status

  if (status !== 'success') return false
  if (lastRunKey.current === null) return false
  return lastRunKey.current !== currentKey
}
