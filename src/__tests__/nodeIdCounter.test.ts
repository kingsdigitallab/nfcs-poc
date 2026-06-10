import { describe, it, expect, beforeEach } from 'vitest'
import { newId, bumpCounterPast } from '../utils/nodeIdCounter'

// The counter is module-level state — bump it well past any prior value each test.
// We use a high base so tests are isolated from whatever the module started at.

let base: number

beforeEach(() => {
  // Generate one id to discover the current counter value, then use that as
  // the starting reference so each test group starts from a known position.
  const probe = newId('probe')
  base = parseInt(probe.split('-')[1], 10)
})

describe('newId', () => {
  it('returns a string with the given prefix', () => {
    const id = newId('node')
    expect(id.startsWith('node-')).toBe(true)
  })

  it('returns unique ids on successive calls', () => {
    const a = newId('x')
    const b = newId('x')
    expect(a).not.toBe(b)
  })

  it('increments the numeric suffix by 1 each call', () => {
    const a = newId('n')
    const b = newId('n')
    const numA = parseInt(a.split('-')[1], 10)
    const numB = parseInt(b.split('-')[1], 10)
    expect(numB).toBe(numA + 1)
  })
})

describe('bumpCounterPast', () => {
  it('ensures the next id is above the highest provided id', () => {
    const high = base + 500
    bumpCounterPast([`node-${high}`, `node-${base + 100}`])
    const next = newId('n')
    const num = parseInt(next.split('-')[1], 10)
    expect(num).toBeGreaterThan(high)
  })

  it('does not decrease the counter when ids are lower than current', () => {
    const before = newId('pre')
    const beforeNum = parseInt(before.split('-')[1], 10)
    bumpCounterPast([`node-1`, `node-2`])
    const after = newId('post')
    const afterNum = parseInt(after.split('-')[1], 10)
    expect(afterNum).toBe(beforeNum + 1)
  })

  it('ignores ids without a numeric suffix', () => {
    expect(() => bumpCounterPast(['no-number-here', 'abc'])).not.toThrow()
  })

  it('handles an empty array without error', () => {
    expect(() => bumpCounterPast([])).not.toThrow()
  })
})
