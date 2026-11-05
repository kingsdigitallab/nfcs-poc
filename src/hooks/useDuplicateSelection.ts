/**
 * useDuplicateSelection — Ctrl+D / Cmd+D duplicates every selected node
 * (groups bring their children; edges between duplicated nodes are copied).
 *
 * The clone set comes from `duplicateNodes` (shared with the ⧉ toolbar
 * button) and is computed OUTSIDE the state updaters, so ids are minted once
 * even under StrictMode. With nothing selected the key is left to the
 * browser (bookmark); while typing in a field it is ignored.
 */
import { useCallback, useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Edge, ReactFlowInstance } from '@xyflow/react'
import { duplicateNodes } from '../utils/duplicateNodes'
import { invokeToggle } from '../utils/groupToggleRegistry'
import type { AppNode } from '../types/AppNode'

/** True when the key event comes from a text-entry element (so Ctrl+D there is left alone). */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable
}

export function useDuplicateSelection(
  rfInstance: ReactFlowInstance | null,
  setNodes: Dispatch<SetStateAction<AppNode[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>,
) {
  /** Duplicate the current selection; returns true when something was cloned. */
  const duplicateSelected = useCallback((): boolean => {
    if (!rfInstance) return false
    const all = rfInstance.getNodes()
    const selected = all.filter(n => n.selected).map(n => n.id)
    if (selected.length === 0) return false

    const { nodes: added, edges: addedEdges, skipped } = duplicateNodes(all, rfInstance.getEdges(), selected)
    if (skipped.length > 0) {
      // A collapsed group's edges run through proxy handles — expand it first
      // (as ungroup and delete do) and let the user press again.
      for (const id of skipped) invokeToggle(id)
      return false
    }
    if (added.length === 0) return false

    setNodes(prev => [...prev.map(n => (n.selected ? { ...n, selected: false } : n)), ...added] as AppNode[])
    if (addedEdges.length > 0) setEdges(prev => [...prev, ...addedEdges])
    return true
  }, [rfInstance, setNodes, setEdges])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.repeat) return
      if (e.key.toLowerCase() !== 'd') return
      if (isTypingTarget(e.target)) return
      if (!rfInstance || !rfInstance.getNodes().some(n => n.selected)) return   // nothing selected → browser default
      e.preventDefault()
      duplicateSelected()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [rfInstance, duplicateSelected])

  return duplicateSelected
}
