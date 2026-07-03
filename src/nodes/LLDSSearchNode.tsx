/**
 * LLDS (Oxford Linguistics, Languages and Dialects) search node — thin config
 * over BackboneSearchNode (task-SN.2). Handle ids/positions live in the shell.
 * No server-side search — the runner filters client-side, clamps limit to 50,
 * and keeps a 24 h localStorage cache with a 'cached' status (amber border).
 * The runner (runLLDSNode.ts) is bespoke and untouched.
 */
import type { NodeProps } from '@xyflow/react'
import { BackboneSearchNode, type BackboneSearchConfig } from './BackboneSearchNode'
import type { UnifiedRecord } from '../types/UnifiedRecord'

export type LLDSStatus = 'idle' | 'loading' | 'success' | 'cached' | 'error'

export interface LLDSSearchNodeData {
  inlineQuery: string
  inlineLimit: string
  /** When true (default), a fresh localStorage cache is reused within 24 h.
   *  Uncheck to force a live fetch on the next Run. */
  useCache:      boolean
  status:        LLDSStatus
  statusMessage: string
  results:       UnifiedRecord[] | undefined
  count:         number
  useFixture?:   boolean
  [key: string]: unknown
}

export const LLDS_CONFIG: BackboneSearchConfig = {
  nodeType: 'lldsSearch',
  title:    'LLDS Search',
  theme: {
    header:       '#92400e',  // amber-brown
    runBtn:       '#78350f',
    accentBg:     '#fef3c7',  // unused (no filter panel) — kept for theme completeness
    accentBorder: '#fde68a',
    sectionBg:    '#fffbeb',
    clearBtn:     '#78350f',
    fixtureIcon:  '#92400e',
  },
  minWidth: 240,
  statusColours:      { cached: '#f59e0b' },
  statusBadgeColours: { cached: '#fcd34d' },
  footer: {
    extraToggle: {
      key:         'useCache',
      label:       'use cache',
      cachedLabel: '📦 cached',
      title:       'Reuse the locally cached result if less than 24 h old. Uncheck to force a live request.',
      onColor:     '#92400e',
      offColor:    '#6b7280',
    },
  },
}

export function LLDSSearchNode(props: NodeProps) {
  return <BackboneSearchNode {...props} config={LLDS_CONFIG} />
}
