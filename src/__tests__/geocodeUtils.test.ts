import { describe, it, expect } from 'vitest'
import { extractToponym, diceCoefficient, detectDomain } from '../utils/geocodeUtils'

describe('extractToponym', () => {
  it('strips parenthetical content and date qualifiers', () => {
    expect(extractToponym('Excavated near Bath (Somerset), England, c.1880')).toBe('Bath')
  })

  it('strips leading place phrases', () => {
    expect(extractToponym('Made in London, England')).toBe('London')
  })

  it('strips parenthetical date and returns first segment', () => {
    expect(extractToponym('Paris, France (c. 1740)')).toBe('Paris')
  })

  it('passes through a bare toponym unchanged', () => {
    expect(extractToponym('Constantinople')).toBe('Constantinople')
  })

  it('handles year ranges', () => {
    expect(extractToponym('Rome, Italy, 1400–1500 CE')).toBe('Rome')
  })

  it('handles circa with a space', () => {
    expect(extractToponym('Florence, circa 1490')).toBe('Florence')
  })
})

describe('diceCoefficient', () => {
  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('Bath', 'Bath')).toBe(1)
  })

  it('returns 0 for strings shorter than 2 chars', () => {
    expect(diceCoefficient('A', 'Bath')).toBe(0)
  })

  it('returns a low score for unrelated strings', () => {
    expect(diceCoefficient('night', 'nacht')).toBeLessThan(0.4)
  })

  it('returns a high score for near-identical strings', () => {
    expect(diceCoefficient('london', 'london')).toBe(1)
    expect(diceCoefficient('london', 'Londres')).toBeGreaterThan(0.2)
  })

  it('is symmetric', () => {
    const a = diceCoefficient('paris', 'parish')
    const b = diceCoefficient('parish', 'paris')
    expect(a).toBeCloseTo(b, 10)
  })
})

describe('detectDomain', () => {
  it('returns natural_history for gbif', () => {
    expect(detectDomain('gbif')).toBe('natural_history')
  })

  it('returns natural_history for ariadne', () => {
    expect(detectDomain('ariadne')).toBe('natural_history')
  })

  it('returns humanities for smg', () => {
    expect(detectDomain('smg')).toBe('humanities')
  })

  it('returns humanities for vam', () => {
    expect(detectDomain('vam')).toBe('humanities')
  })

  it('returns humanities for unknown sources', () => {
    expect(detectDomain('')).toBe('humanities')
    expect(detectDomain('europeana')).toBe('humanities')
  })
})
