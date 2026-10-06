import { describe, it, expect } from 'vitest'
import { extractHtml } from '../utils/htmlExtract'

const PAGE = `
<html><body>
  <nav>Menu</nav>
  <main>
    <h2 id="intro">Introduction</h2>
    <p>First para of intro.</p>
    <p>Second para of intro.</p>
    <h2 id="methods">Methods</h2>
    <p>Methods text.</p>
    <h3>Sub-method</h3>
    <p>Sub text.</p>
  </main>
</body></html>`

describe('extractHtml', () => {
  it('selector mode joins matching elements as text', () => {
    const out = extractHtml(PAGE, { selector: 'main p', separator: ' | ', preserveHtml: false, extractSection: false })
    expect(out).toBe('First para of intro. | Second para of intro. | Methods text. | Sub text.')
  })

  it('selector mode can preserve outer HTML', () => {
    const out = extractHtml(PAGE, { selector: 'nav', separator: '\n', preserveHtml: true, extractSection: false })
    expect(out).toBe('<nav>Menu</nav>')
  })

  it('section mode takes the heading and its siblings up to the next heading of equal or higher rank', () => {
    const out = extractHtml(PAGE, { selector: '#methods', separator: ' / ', preserveHtml: false, extractSection: true })
    expect(out).toBe('Methods / Methods text. / Sub-method / Sub text.')
  })

  it('@readability mode returns the main article text', () => {
    const out = extractHtml(PAGE, { selector: '@readability', separator: '\n', preserveHtml: false, extractSection: false })
    // Readability keeps short pages mostly intact; the contract we rely on is
    // "article text comes back as plain text", not nav stripping on tiny inputs.
    expect(out).toContain('First para of intro.')
    expect(out).not.toContain('<p>')
  })

  it('returns an empty string when nothing matches or the input is malformed', () => {
    expect(extractHtml(PAGE, { selector: '#nope', separator: '', preserveHtml: false, extractSection: false })).toBe('')
    expect(extractHtml(PAGE, { selector: '#nope', separator: '', preserveHtml: false, extractSection: true })).toBe('')
    expect(extractHtml(PAGE, { selector: '[[[', separator: '', preserveHtml: false, extractSection: false })).toBe('')
  })
})
