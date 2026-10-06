import { describe, it, expect, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { runHTMLSectionNode } from '../utils/runHTMLSectionNode'
import { setNodeResults, getNodeResults, clearNodeResults } from '../store/resultsStore'

const HTML = `<html><body><main>
  <h2 id="a">Alpha</h2><p>Alpha text.</p>
  <h2 id="b">Beta</h2><p>Beta text.</p>
</main></body></html>`

function setup(data: Record<string, unknown>) {
  clearNodeResults('src'); clearNodeResults('h')
  setNodeResults('src', [{ id: 'r1', fetchedHtml: HTML }])
  const nodes: Node[] = [
    { id: 'src', type: 'urlFetch', position: { x: 0, y: 0 }, data: {} },
    { id: 'h',   type: 'htmlSection', position: { x: 0, y: 0 }, data },
  ]
  const edges: Edge[] = [{ id: 'e', source: 'src', target: 'h', targetHandle: 'data' }]
  const updates: Record<string, unknown>[] = []
  const updateNodeData = (_id: string, d: Record<string, unknown>) => { updates.push(d) }
  return { nodes, edges, updates, updateNodeData }
}

describe('runHTMLSectionNode honours every extraction mode the component offers', () => {
  beforeEach(() => { clearNodeResults('src'); clearNodeResults('h') })

  it('section mode (extractSection) extracts the heading plus its section under Run All', async () => {
    const { nodes, edges, updateNodeData } = setup({ selector: '#a', separator: ' / ', extractSection: true })
    await runHTMLSectionNode('h', () => nodes, edges, updateNodeData)
    const [rec] = getNodeResults('h') ?? []
    expect(rec?.fetchedContent).toBe('Alpha / Alpha text.')
  })

  it('@readability mode works under Run All', async () => {
    const { nodes, edges, updateNodeData } = setup({ selector: '@readability', separator: '\n' })
    await runHTMLSectionNode('h', () => nodes, edges, updateNodeData)
    const [rec] = getNodeResults('h') ?? []
    expect(String(rec?.fetchedContent)).toContain('Alpha text.')
  })

  it('an empty selector behaves like the component (no match), not like the default', async () => {
    const { nodes, edges, updateNodeData } = setup({ selector: '', separator: ' | ' })
    await runHTMLSectionNode('h', () => nodes, edges, updateNodeData)
    const [rec] = getNodeResults('h') ?? []
    expect(rec?.fetchedContent).toBe('')
  })

  it('plain selector mode is unchanged', async () => {
    const { nodes, edges, updateNodeData } = setup({ selector: 'p', separator: ' | ' })
    await runHTMLSectionNode('h', () => nodes, edges, updateNodeData)
    const [rec] = getNodeResults('h') ?? []
    expect(rec?.fetchedContent).toBe('Alpha text. | Beta text.')
  })
})
