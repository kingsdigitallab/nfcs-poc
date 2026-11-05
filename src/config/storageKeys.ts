/** Centralised localStorage key constants — prevents typo-bugs across the codebase. */
export const STORAGE_KEYS = {
  /** Current node-visibility tier: 'basic' | 'intermediate' | 'full' (see config/nodeTiers.ts). */
  NODE_TIER:              'nfcs_node_tier',
  /** LEGACY (pre-Nov-2026 Simple/Advanced toggle) — read once to migrate into NODE_TIER, never written. */
  SIMPLE_MODE:            'nfcs_simple_mode',
  AUTHOR_MODE:            'nfcs_author_mode',
  /** JSON string[] of Examples-menu group names the user has COLLAPSED (groups default to open). */
  EXAMPLE_GROUPS_CLOSED:  'nfcs_example_groups_closed',
  SNAP_GRID:              'nfcs_snap_grid',
  CHAT_MODEL:             'kcl_chat_model',
  CHAT_SYSTEM_PROMPT:     'kcl_chat_system',
  CHAT_SYSTEM_VERSION:    'kcl_chat_system_version',
  PROMPT_RECIPES:         'nfcs_prompt_recipes',
  PROMPT_RECIPES_VERSION: 'nfcs_prompt_recipes_version',
  NOTES_LEGACY:           'nfcs_notes',
} as const
