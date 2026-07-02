/**
 * fetch with an AbortController-backed timeout — the shared version of the
 * pattern most runners implement inline. A fetch without a timeout can hang
 * a Run All wave indefinitely; always use this (or an explicit
 * AbortController) for network calls in runners and shared clients.
 */

export const DEFAULT_FETCH_TIMEOUT = 30_000

export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Chain an already-supplied signal so callers keep their own cancel path.
  const external = init.signal
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted && !(external?.aborted)) {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
