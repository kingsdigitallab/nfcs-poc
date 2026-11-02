import { describe, it, expect, afterEach } from 'vitest'
import { randomUUID } from '../utils/uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const native = globalThis.crypto.randomUUID

describe('randomUUID', () => {
  afterEach(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: native, configurable: true, writable: true })
  })

  it('returns a v4 UUID when the platform implementation exists', () => {
    expect(randomUUID()).toMatch(UUID_V4)
  })

  it('still returns a v4 UUID when crypto.randomUUID is unavailable (plain-http LAN origin)', () => {
    // Browsers expose crypto.randomUUID only in secure contexts (https / localhost).
    // Over http://192.168.x.x it is undefined and the app crashed at startup.
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true, writable: true })
    const a = randomUUID()
    const b = randomUUID()
    expect(a).toMatch(UUID_V4)
    expect(b).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })
})
