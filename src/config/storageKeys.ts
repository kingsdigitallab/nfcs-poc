/** Centralised localStorage key constants — prevents typo-bugs across the codebase. */
export const STORAGE_KEYS = {
  SIMPLE_MODE:            'nfcs_simple_mode',
  AUTHOR_MODE:            'nfcs_author_mode',
  SNAP_GRID:              'nfcs_snap_grid',
  CHAT_MODEL:             'kcl_chat_model',
  CHAT_SYSTEM_PROMPT:     'kcl_chat_system',
  CHAT_SYSTEM_VERSION:    'kcl_chat_system_version',
  PROMPT_RECIPES:         'nfcs_prompt_recipes',
  PROMPT_RECIPES_VERSION: 'nfcs_prompt_recipes_version',
  NOTES_LEGACY:           'nfcs_notes',
} as const
