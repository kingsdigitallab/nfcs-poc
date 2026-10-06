/**
 * htmlExtract — the ONE implementation of HTMLSection's three extraction
 * modes, shared by the component's ▶ Run / live preview and the runner
 * (Run All). Keeping these in one place is what guarantees the two paths
 * produce identical output.
 *
 *   selector === '@readability'  → Mozilla Readability (Reader-Mode article)
 *   extractSection === true      → heading matched by selector + following
 *                                  siblings up to the next heading of equal
 *                                  or higher rank
 *   otherwise                    → every element matching the CSS selector
 *
 * All modes return '' on no match or malformed input — they never throw.
 */
import { Readability } from '@mozilla/readability'

export interface HtmlExtractOptions {
  selector: string
  separator: string
  preserveHtml: boolean
  extractSection: boolean
}

export const READABILITY_SELECTOR = '@readability'

function textOf(el: Element, preserveHtml: boolean): string {
  return preserveHtml ? el.outerHTML : (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function extractBySelector(html: string, selector: string, separator: string, preserveHtml: boolean): string {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const els = doc.querySelectorAll(selector)
    if (els.length === 0) return ''
    return Array.from(els).map(el => textOf(el, preserveHtml)).filter(Boolean).join(separator)
  } catch {
    return ''
  }
}

export function extractSectionFromHeading(html: string, selector: string, separator: string, preserveHtml: boolean): string {
  try {
    const doc     = new DOMParser().parseFromString(html, 'text/html')
    const heading = doc.querySelector(selector)
    if (!heading) return ''
    const level = parseInt(heading.tagName[1]) || 0
    const parts: string[] = [textOf(heading, preserveHtml)]
    let sibling = heading.nextElementSibling
    while (sibling) {
      const tag = sibling.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag) && parseInt(tag[1]) <= level) break
      const content = textOf(sibling, preserveHtml)
      if (content) parts.push(content)
      sibling = sibling.nextElementSibling
    }
    return parts.filter(Boolean).join(separator)
  } catch {
    return ''
  }
}

export function extractReadability(html: string, preserveHtml: boolean): string {
  try {
    const doc     = new DOMParser().parseFromString(html, 'text/html')
    const article = new Readability(doc).parse()
    if (!article) return ''
    return preserveHtml
      ? (article.content ?? '')
      : (article.textContent ?? '').replace(/\s+/g, ' ').trim()
  } catch {
    return ''
  }
}

/** Dispatch on the node's configuration — the single entry point callers should use. */
export function extractHtml(html: string, opts: HtmlExtractOptions): string {
  const { selector, separator, preserveHtml, extractSection } = opts
  if (selector === READABILITY_SELECTOR) return extractReadability(html, preserveHtml)
  if (extractSection) return extractSectionFromHeading(html, selector, separator, preserveHtml)
  return extractBySelector(html, selector, separator, preserveHtml)
}
