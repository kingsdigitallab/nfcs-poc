/** Type declarations for server/urlProxyPolicy.mjs (plain ESM, shared by vite dev + Express). */
export const WAIT_STRATEGIES: Set<string>
export const MAX_RESPONSE_BYTES: number
export function parseAllowlist(envValue: string | undefined): string[]
export function isPrivateHost(hostname: string): boolean
export type TargetDecision = { ok: true; url: URL } | { ok: false; reason: string }
export function isAllowedTarget(
  urlString: string,
  allowlist: readonly string[],
  opts?: { allowAll?: boolean },
): TargetDecision
