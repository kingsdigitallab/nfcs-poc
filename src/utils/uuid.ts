/**
 * `crypto.randomUUID()` exists only in secure contexts (https or localhost).
 * When the dev server is reached over plain http on the LAN — e.g. an iPad at
 * http://192.168.x.x:5174 — it is undefined and the app crashed at startup
 * (useWorkflowIO creates the workflow id on first render). `getRandomValues`
 * is available everywhere, so fall back to a hand-assembled v4 UUID.
 */
export function randomUUID(): string {
  const c = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  c.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40   // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80   // RFC 4122 variant
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
