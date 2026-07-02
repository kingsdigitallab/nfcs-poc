import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Node, Edge } from '@xyflow/react'

/**
 * runWorkflow imports the real nodeRunners registry at module level; mock it
 * with a mutable registry so tests control which node types are "runnable"
 * and what each runner does, without pulling in every real runner.
 */
const { mockRunners } = vi.hoisted(() => ({
  mockRunners: {} as Record<
    string,
    (
      nodeId: string,
      getNodes: () => Node[],
      edges: Edge[],
      updateNodeData: (id: string, data: Record<string, unknown>) => void,
    ) => Promise<void>
  >,
}))

vi.mock('../utils/nodeRunners', () => ({ nodeRunners: mockRunners }))

import { runWorkflow } from '../utils/runWorkflow'

const makeNode = (id: string, type: string, data: Record<string, unknown> = {}): Node => ({
  id,
  type,
  position: { x: 0, y: 0 },
  data,
})

const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  targetHandle: 'data',
})

beforeEach(() => {
  for (const k of Object.keys(mockRunners)) delete mockRunners[k]
})

describe('runWorkflow wave ordering (Kahn)', () => {
  it('runs upstream nodes before their dependants', async () => {
    const order: string[] = []
    mockRunners.source = async id => { order.push(id) }
    mockRunners.process = async id => { order.push(id) }
    mockRunners.output = async id => { order.push(id) }

    const nodes = [
      makeNode('s1', 'source'),
      makeNode('p1', 'process'),
      makeNode('o1', 'output'),
    ]
    const edges = [edge('s1', 'p1'), edge('p1', 'o1')]

    await runWorkflow(() => nodes, edges, () => {})

    expect(order).toEqual(['s1', 'p1', 'o1'])
  })

  it('runs independent sources in the same wave, then the join node', async () => {
    const waves: string[][] = []
    let currentWave: string[] = []
    const record = async (id: string) => {
      currentWave.push(id)
      // Yield so same-wave runners interleave before the next wave starts
      await Promise.resolve()
    }
    mockRunners.source = async id => { await record(id) }
    mockRunners.join = async id => {
      waves.push([...currentWave])
      currentWave = []
      await record(id)
    }

    const nodes = [
      makeNode('s1', 'source'),
      makeNode('s2', 'source'),
      makeNode('j1', 'join'),
    ]
    const edges = [edge('s1', 'j1'), edge('s2', 'j1')]

    await runWorkflow(() => nodes, edges, () => {})

    // Both sources completed before the join ran
    expect(waves[0].sort()).toEqual(['s1', 's2'])
  })

  it('ignores non-runnable nodes for ordering', async () => {
    const order: string[] = []
    mockRunners.source = async id => { order.push(id) }

    const nodes = [
      makeNode('param-1', 'param', { value: 'stonehenge' }),
      makeNode('s1', 'source'),
    ]
    // param -> source edge exists, but param has no runner
    const edges = [edge('param-1', 's1')]

    await runWorkflow(() => nodes, edges, () => {})

    expect(order).toEqual(['s1'])
  })
})

describe('runWorkflow failure handling', () => {
  it('skips dependants of a failed node but runs unrelated branches', async () => {
    const ran: string[] = []
    const statuses: Record<string, unknown> = {}
    mockRunners.source = async id => {
      ran.push(id)
      if (id === 'bad') throw new Error('boom')
    }
    mockRunners.output = async id => { ran.push(id) }

    const nodes = [
      makeNode('bad', 'source'),
      makeNode('downstream', 'output'),
      makeNode('ok', 'source'),
      makeNode('ok-out', 'output'),
    ]
    const edges = [edge('bad', 'downstream'), edge('ok', 'ok-out')]

    await runWorkflow(() => nodes, edges, (id, data) => { statuses[id] = data })

    // The unrelated branch completed in full
    expect(ran).toContain('ok')
    expect(ran).toContain('ok-out')
    // The dependant of the failed node never ran and was marked skipped
    expect(ran).not.toContain('downstream')
    expect(statuses.downstream).toMatchObject({ status: 'error' })
    expect(String((statuses.downstream as Record<string, unknown>).statusMessage)).toContain('Skipped')
  })

  it('treats a throwing runner as failed without aborting the workflow', async () => {
    const statuses: Record<string, unknown> = {}
    mockRunners.source = async () => { throw new Error('unexpected') }
    mockRunners.output = async () => {}

    const nodes = [makeNode('s1', 'source'), makeNode('o1', 'output')]
    const edges = [edge('s1', 'o1')]

    await expect(
      runWorkflow(() => nodes, edges, (id, data) => { statuses[id] = data }),
    ).resolves.toBeUndefined()

    expect(statuses.s1).toMatchObject({ status: 'error' })
  })
})
