import { describe, it, expect } from 'vitest'
import { STATUS_BORDER, STATUS_BADGE } from '../styles/theme'

/**
 * Runners write both 'loading' (search nodes) and 'running' (process nodes)
 * as their in-flight status. The shared theme must colour both, or nodes
 * that use 'running' silently fall back to the idle border.
 */
describe('theme status maps', () => {
  it.each(['idle', 'loading', 'running', 'success', 'error', 'cached'])('STATUS_BORDER has %s', s => {
    expect(STATUS_BORDER[s]).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it.each(['idle', 'loading', 'running', 'success', 'error', 'cached'])('STATUS_BADGE has %s', s => {
    expect(STATUS_BADGE[s]).toMatch(/^#[0-9a-f]{6}$/i)
  })
  it("treats 'running' and 'loading' as the same in-flight state", () => {
    expect(STATUS_BORDER.running).toBe(STATUS_BORDER.loading)
    expect(STATUS_BADGE.running).toBe(STATUS_BADGE.loading)
  })
})
