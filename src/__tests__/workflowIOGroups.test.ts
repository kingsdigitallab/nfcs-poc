import { describe, it, expect } from 'vitest'
import type { Node, Edge } from '@xyflow/react'
import { buildWorkflowPayload, hydrateNodes, partitionUnknownNodes } from '../utils/workflowIO'
import { DEFAULT_KCL_API_KEY } from '../utils/kclConfig'

/**
 * A collapsed group rewrites the edges crossing its boundary: an inbound edge
 * becomes target=group / targetHandle='proxy-in-N' and the real endpoint is
 * remembered in group.data.proxyEdges. Anything in the save/load path that
 * reasons about edge endpoints must see through that rewrite.
 */
const makeNode = (id: string, type: string, data: Record<string, unknown> = {}, extra: Partial<Node> = {}): Node => ({
  id, type, position: { x: 10, y: 20 }, data, ...extra,
})

const collapsedGroupNodes = () => [
  makeNode('p1', 'param', { label: 'key', paramType: 'text', value: 'sk-secret-value' }),
  makeNode('g1', 'group', {
    collapsed: true,
    proxyEdges: [{ edgeId: 'e1', side: 'in', slot: 0, originalSource: 'p1', originalTarget: 'k1', originalSourceHandle: null, originalTargetHandle: 'apiKey' }],
  }),
  makeNode('k1', 'kclNode', { model: 'arc:nano' }, { parentId: 'g1' }),
]
const proxyEdges: Edge[] = [{ id: 'e1', source: 'p1', target: 'g1', targetHandle: 'proxy-in-0' }]

describe('credential Params and collapsed groups', () => {
  it('blanks the Param value when the apiKey edge is proxied through a collapsed group', () => {
    const payload = buildWorkflowPayload(collapsedGroupNodes(), proxyEdges)
    expect(JSON.stringify(payload)).not.toContain('sk-secret-value')
    expect(payload.nodes.find(n => n.id === 'p1')?.data.value).toBe('')
  })

  it('hydrateNodes re-fills a blanked credential Param with the build-time default (direct edge)', () => {
    const file = buildWorkflowPayload(
      [makeNode('p1', 'param', { label: 'key', paramType: 'text', value: 'sk-secret-value' }), makeNode('k1', 'kclNode', { model: 'arc:nano' })],
      [{ id: 'e1', source: 'p1', target: 'k1', targetHandle: 'apiKey' }],
    )
    expect(hydrateNodes(file).find(n => n.id === 'p1')?.data.value).toBe(DEFAULT_KCL_API_KEY)
  })

  it('hydrateNodes re-fills a blanked credential Param behind a collapsed group', () => {
    const file = buildWorkflowPayload(collapsedGroupNodes(), proxyEdges)
    expect(hydrateNodes(file).find(n => n.id === 'p1')?.data.value).toBe(DEFAULT_KCL_API_KEY)
  })

  it('leaves a non-credential Param value alone on save and load', () => {
    const file = buildWorkflowPayload(
      [makeNode('p2', 'param', { label: 'limit', paramType: 'integer', value: '50' }), makeNode('k1', 'kclNode', {})],
      [{ id: 'e2', source: 'p2', target: 'k1', targetHandle: 'limit' }],
    )
    expect(file.nodes.find(n => n.id === 'p2')?.data.value).toBe('50')
    expect(hydrateNodes(file).find(n => n.id === 'p2')?.data.value).toBe('50')
  })
})

describe('partitionUnknownNodes and collapsed groups', () => {
  it('drops proxied edges and proxyEdges records that point at a dropped child', () => {
    const file = buildWorkflowPayload(
      [
        makeNode('gbif-1', 'gbifSearch', {}),
        makeNode('g1', 'group', {
          collapsed: true,
          proxyEdges: [
            { edgeId: 'e1', side: 'in',  slot: 0, originalSource: 'gbif-1', originalTarget: 'ads-1',  originalTargetHandle: 'data' },
            { edgeId: 'e2', side: 'out', slot: 0, originalSource: 'ads-1',  originalTarget: 't1',     originalSourceHandle: 'results' },
            { edgeId: 'e3', side: 'in',  slot: 1, originalSource: 'gbif-1', originalTarget: 'keep-1', originalTargetHandle: 'data' },
          ],
        }),
        makeNode('ads-1',  'adsSearchAdvanced', {}, { parentId: 'g1' }),
        makeNode('keep-1', 'deduplicate',       {}, { parentId: 'g1' }),
        makeNode('t1', 'tableOutput', {}),
      ],
      [
        { id: 'e1', source: 'gbif-1', target: 'g1', targetHandle: 'proxy-in-0' },
        { id: 'e2', source: 'g1', sourceHandle: 'proxy-out-0', target: 't1', targetHandle: 'results' },
        { id: 'e3', source: 'gbif-1', target: 'g1', targetHandle: 'proxy-in-1' },
      ],
    )
    const { file: cleaned, dropped } = partitionUnknownNodes(file, new Set(['gbifSearch', 'group', 'deduplicate', 'tableOutput']))
    expect(dropped.map(d => d.id)).toEqual(['ads-1'])
    expect(cleaned.edges.map(e => e.id)).toEqual(['e3'])
    const group = cleaned.nodes.find(n => n.id === 'g1')
    expect((group?.data.proxyEdges as { edgeId: string }[]).map(p => p.edgeId)).toEqual(['e3'])
  })
})
