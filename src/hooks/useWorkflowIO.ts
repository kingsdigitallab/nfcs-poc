/**
 * useWorkflowIO — save/load/apply workflow logic, extracted verbatim from
 * App.tsx (task 5.6 decomposition).
 */
import { useCallback, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { bumpCounterPast } from '../utils/nodeIdCounter'
import {
  buildWorkflowPayload, downloadWorkflow, parseWorkflowFile, hydrateNodes,
  partitionUnknownNodes, type WorkflowFile,
} from '../utils/workflowIO'
import { nodeTypes } from '../nodes'
import { exportNotes, importNotes } from '../store/notesStore'
import { clearAllResults } from '../store/resultsStore'
import type { AppNode } from '../types/AppNode'

const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(Object.keys(nodeTypes))

export function useWorkflowIO(
  nodes: AppNode[],
  edges: Edge[],
  setNodes: Dispatch<SetStateAction<AppNode[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
) {
  // Identity for the notes authored in this workflow; saved into the file so a
  // reloaded/loaded workflow restores its notes, while a blank canvas is fresh.
  const workflowIdRef = useRef<string>(crypto.randomUUID())
  const [loadError, setLoadError] = useState<string | null>(null)

  const handleSave = useCallback(() => {
    const extras = { workflowId: workflowIdRef.current, notes: exportNotes() }
    const payload = buildWorkflowPayload(nodes, edges, extras)
    downloadWorkflow(nodes, edges, extras)
    fetch('/api/save-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }, [nodes, edges])

  // Shared workflow application logic — used by both file Load and Example load.
  const applyWorkflow = useCallback((incoming: WorkflowFile) => {
    // Nodes of a type this build no longer registers are dropped (with their
    // edges) and reported, so the rest of the workflow still loads.
    const { file: wf, dropped } = partitionUnknownNodes(incoming, KNOWN_NODE_TYPES)
    // The incoming canvas replaces every node; results keyed by the old
    // node ids would otherwise leak (and could collide with reused ids).
    clearAllResults()
    const hydrated = hydrateNodes(wf)
    bumpCounterPast(hydrated.map(n => n.id))
    // Adopt the loaded workflow's identity and restore its notes (replacing any
    // notes from the previously-open workflow in this session).
    workflowIdRef.current = wf.workflowId ?? crypto.randomUUID()
    importNotes(wf.notes)
    setNodes(hydrated as AppNode[])
    // Strip edges that reference proxy handles of expanded groups — these are
    // stale refs left by incomplete collapse/expand cycles in a prior session.
    const expandedGroupIds = new Set(
      hydrated
        .filter((n: Node) => n.type === 'group' && !(n.data as any).collapsed)
        .map(n => n.id),
    )
    setEdges(
      wf.edges.filter(
        ed =>
          !(ed.sourceHandle?.startsWith('proxy-out-') && expandedGroupIds.has(ed.source)) &&
          !(ed.targetHandle?.startsWith('proxy-in-') && expandedGroupIds.has(ed.target)),
      ),
    )
    if (dropped.length > 0) {
      const types = [...new Set(dropped.map(d => d.type))].join(', ')
      setLoadError(`Loaded with ${dropped.length} unsupported node(s) removed: ${types}`)
    } else {
      setLoadError(null)
    }
  }, [setNodes, setEdges])

  const handleLoadFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    // Reset input so the same file can be re-loaded if needed
    e.target.value = ''
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const wf = parseWorkflowFile(ev.target?.result as string)
        applyWorkflow(wf)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load workflow.')
      }
    }
    reader.readAsText(file)
  }, [applyWorkflow])

  return { handleSave, applyWorkflow, handleLoadFile, loadError, setLoadError }
}
