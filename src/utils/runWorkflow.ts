/**
 * Workflow executor — runs all runnable nodes in the correct dependency order.
 *
 * Execution model
 * ───────────────
 * 1. Build a dependency graph over *runnable* nodes only (edges to/from
 *    non-runnable nodes like ParamNode are ignored for ordering purposes —
 *    their values are read directly at run-time by each runner).
 * 2. Execute in waves using Kahn's algorithm:
 *      Wave 0 — nodes with no runnable upstream deps  (run in parallel)
 *      Wave 1 — nodes whose every dep completed Wave 0 (run in parallel)
 *      …
 * 3. Before each wave, take a fresh snapshot of all nodes so runners can
 *    read outputs that upstream nodes wrote in the previous wave.
 * 4. A node whose upstream dep *failed* is skipped and marked with an error
 *    status — it does not prevent unrelated branches from running.
 * 5. Runners are trusted to never throw (they catch internally and set their
 *    own status). If one somehow does throw, it is caught here and treated
 *    as a failure so the rest of the workflow continues.
 */
import type { Node, Edge } from '@xyflow/react'
import { nodeRunners } from './nodeRunners'

export async function runWorkflow(
  getNodes: () => Node[],
  edges: Edge[],
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const allNodes = getNodes()
  const runnableNodes = allNodes.filter(n => n.type != null && n.type in nodeRunners)

  if (runnableNodes.length === 0) {
    console.log('[Workflow] no runnable nodes found')
    return
  }

  console.log(`[Workflow] starting — ${runnableNodes.length} runnable node(s)`)

  // Build dependency sets: for each runnable node, which other runnable nodes
  // must complete before it can run?
  const runnableIds = new Set(runnableNodes.map(n => n.id))
  const deps = new Map<string, Set<string>>()
  for (const node of runnableNodes) {
    deps.set(node.id, new Set())
  }
  for (const edge of edges) {
    if (runnableIds.has(edge.source) && runnableIds.has(edge.target)) {
      deps.get(edge.target)!.add(edge.source)
    }
  }

  const completed = new Set<string>()
  const failed    = new Set<string>()
  let remaining   = [...runnableNodes]

  while (remaining.length > 0) {
    // Nodes ready to run: all their deps have completed (not failed)
    const wave = remaining.filter(n => {
      const nodeDeps = deps.get(n.id)!
      return (
        [...nodeDeps].every(dep => completed.has(dep)) &&
        [...nodeDeps].every(dep => !failed.has(dep))
      )
    })

    // Nodes blocked because a dep failed
    const blocked = remaining.filter(n => {
      const nodeDeps = deps.get(n.id)!
      return [...nodeDeps].some(dep => failed.has(dep))
    })

    for (const n of blocked) {
      console.warn(`[Workflow] skipping ${n.id} — upstream dependency failed`)
      updateNodeData(n.id, {
        status: 'error',
        statusMessage: '✗ Skipped — upstream failed',
      })
      failed.add(n.id)
    }

    if (wave.length === 0) {
      // Nothing can progress — either all done or a cycle (shouldn't happen
      // with a valid React Flow graph, but guard anyway)
      break
    }

    console.log(`[Workflow] wave — running: ${wave.map(n => n.id).join(', ')}`)

    // Take a fresh node snapshot so this wave sees upstream outputs
    const currentNodes = getNodes()

    await Promise.all(
      wave.map(async n => {
        try {
          await nodeRunners[n.type!](n.id, getNodes, edges, updateNodeData)
          completed.add(n.id)
        } catch (err) {
          // Runner shouldn't throw, but if it does treat as failure
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[Workflow] unexpected throw from runner for ${n.id}:`, msg)
          updateNodeData(n.id, { status: 'error', statusMessage: `✗ ${msg}` })
          failed.add(n.id)
        }
      })
    )

    // Remove this wave (and any newly blocked nodes) from remaining
    remaining = remaining.filter(n => !completed.has(n.id) && !failed.has(n.id))
  }

  console.log(
    `[Workflow] done — completed: ${completed.size}, failed/skipped: ${failed.size}`,
  )
}
