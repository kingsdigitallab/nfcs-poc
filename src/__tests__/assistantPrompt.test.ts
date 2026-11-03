/**
 * The Assistant's built-in system prompt must keep up with the palette.
 *
 * It is a hand-written string (not generated from the README or the sidebar),
 * cached in localStorage and refreshed only when SYSTEM_VERSION changes — so a
 * new node that is never added to it, or a prompt edit without a version bump,
 * used to go unnoticed. These tests make both a red run.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_SYSTEM, SYSTEM_VERSION } from '../config/assistantPrompt'
import { SIDEBAR_ITEMS } from '../config/sidebarItems'
import { NODE_TIERS, TIER_LABELS } from '../config/nodeTiers'

/** The version shipped before the Nov 2026 currency pass — any edit must move past it. */
const PREVIOUS_VERSION = '2026-11-02-v4'

describe('assistant system prompt', () => {
  it('names every node the palette can show, by its display label', () => {
    const missing = SIDEBAR_ITEMS
      .filter(i => !i.hidden)
      .map(i => i.label)
      .filter(label => !DEFAULT_SYSTEM.includes(`**${label}**`))
    expect(missing).toEqual([])
  })

  it('explains the node visibility tiers by name', () => {
    for (const t of NODE_TIERS) expect(DEFAULT_SYSTEM).toContain(TIER_LABELS[t])
    expect(DEFAULT_SYSTEM).toMatch(/visibility tier/i)
  })

  it('SYSTEM_VERSION is a dated version string bumped past the previous release', () => {
    expect(SYSTEM_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}-v\d+$/)
    expect(SYSTEM_VERSION > PREVIOUS_VERSION).toBe(true)
  })

  it('stays a prompt, not a manual', () => {
    // ~20 k chars (≈ 5–6 k tokens) at the Nov 2026 rewrite; the live canvas block adds ≤ 1.5 k
    // and the chat history sits on top — keep the static part under 30 k.
    expect(DEFAULT_SYSTEM.length).toBeLessThan(30_000)
  })
})
