/**
 * Node visibility tiers — Basic / Intermediate / Full.
 *
 * Every `SidebarItem` declares the MINIMUM tier at which it appears in the
 * palette (and in connection suggestions). The user's choice is persisted in
 * localStorage under `STORAGE_KEYS.NODE_TIER`; the pre-Nov-2026 two-state
 * `nfcs_simple_mode` key is migrated on first read (`resolveStoredTier`).
 *
 * Pure module — no React, no DOM — so it is unit-testable (`nodeTiers.test.ts`).
 */

export const NODE_TIERS = ['basic', 'intermediate', 'full'] as const
export type NodeTier = typeof NODE_TIERS[number]

const TIER_RANK: Record<NodeTier, number> = { basic: 0, intermediate: 1, full: 2 }

export const TIER_LABELS: Record<NodeTier, string> = {
  basic:        'Basic',
  intermediate: 'Intermediate',
  full:         'Full',
}

export const TIER_HINTS: Record<NodeTier, string> = {
  basic:        'Basic — the fundamental nodes: search sources, AI inference, table/map/timeline, export.',
  intermediate: 'Intermediate — adds QuickStart, URL/HTML/XML extraction, reconciliation, filtering and inspectors.',
  full:         'Full — every node, including experimental and specialised ones.',
}

export function isNodeTier(v: unknown): v is NodeTier {
  return typeof v === 'string' && (NODE_TIERS as readonly string[]).includes(v)
}

/** True when a node that requires `required` should be visible at `current`. */
export function tierIncludes(current: NodeTier, required: NodeTier): boolean {
  return TIER_RANK[current] >= TIER_RANK[required]
}

/**
 * Resolve the persisted tier. A valid value under the new key wins; otherwise
 * the legacy Simple/Advanced boolean is mapped (Simple → basic, Advanced → full);
 * otherwise the default is basic.
 */
export function resolveStoredTier(stored: string | null, legacySimple: string | null): NodeTier {
  if (isNodeTier(stored)) return stored
  if (legacySimple === 'true')  return 'basic'
  if (legacySimple === 'false') return 'full'
  return 'basic'
}
