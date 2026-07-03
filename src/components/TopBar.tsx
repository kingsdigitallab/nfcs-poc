/**
 * TopBar — title, save/load, notes, grouping, mode toggles and Run All,
 * extracted verbatim from App.tsx (task 5.6). Author-mode state, the
 * version-click easter egg, the save-as-example dialog and the hidden file
 * input are internal; workflow-level actions arrive as props.
 */
import { useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import { STORAGE_KEYS } from '../config/storageKeys'
import { topBarStyle, templateBtnStyle, runAllBtnStyle } from '../styles/appStyles'
import { buildWorkflowPayload, type WorkflowFile } from '../utils/workflowIO'
import { clearAllNotes } from '../store/notesStore'
import { ExampleMenu } from './ExampleMenu'
import { FixtureReferenceCard } from './FixtureReferenceCard'
import { FixturePreflightPanel } from './FixturePreflightPanel'
import { UsefulLinksModal } from './UsefulLinksModal'
import type { AppNode } from '../types/AppNode'
import type { Dispatch, SetStateAction } from 'react'

export interface TopBarProps {
  nodes: AppNode[]
  edges: Edge[]
  setNodes: Dispatch<SetStateAction<AppNode[]>>
  loadError: string | null
  setLoadError: (msg: string | null) => void
  applyWorkflow: (wf: WorkflowFile) => void
  onSave: () => void
  onLoadFile: (e: React.ChangeEvent<HTMLInputElement>) => void
  onGroupSelected: () => void
  onUngroup: () => void
  onPickCachedSearch: (service: string, slug: string) => void
  simpleMode: boolean
  onToggleSimpleMode: () => void
  snapEnabled: boolean
  onToggleSnap: () => void
  chatOpen: boolean
  onToggleChat: () => void
  runningAll: boolean
  onRunAll: () => void
}

export function TopBar({
  nodes, edges, setNodes,
  loadError, setLoadError, applyWorkflow, onSave, onLoadFile,
  onGroupSelected, onUngroup, onPickCachedSearch,
  simpleMode, onToggleSimpleMode, snapEnabled, onToggleSnap,
  chatOpen, onToggleChat, runningAll, onRunAll,
}: TopBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Author mode: click the version text 5× to unlock "Save as Example" ──
  const [authorMode, setAuthorMode] = useState(
    () => localStorage.getItem(STORAGE_KEYS.AUTHOR_MODE) === 'true',
  )
  const versionClicksRef = useRef(0)
  const versionClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleVersionClick = () => {
    versionClicksRef.current += 1
    if (versionClickTimerRef.current) clearTimeout(versionClickTimerRef.current)
    versionClickTimerRef.current = setTimeout(() => { versionClicksRef.current = 0 }, 2000)
    if (versionClicksRef.current >= 5) {
      versionClicksRef.current = 0
      setAuthorMode(m => {
        const next = !m
        localStorage.setItem(STORAGE_KEYS.AUTHOR_MODE, String(next))
        return next
      })
    }
  }

  // ── Save-as-example dialog ──
  const [exampleDialog, setExampleDialog] = useState<{ title: string; description: string } | null>(null)

  async function handleSaveExample() {
    if (!exampleDialog) return
    const title = exampleDialog.title.trim()
    if (!title) return
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const workflow = buildWorkflowPayload(nodes, edges)
    try {
      const r = await fetch('/dev/write-example', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title, description: exampleDialog.description.trim(), workflow }),
      })
      if (!r.ok) throw new Error(await r.text())
      setExampleDialog(null)
    } catch (e) {
      alert(`Failed to save example: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div style={topBarStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1 }}>
        <span style={{ fontSize: 13, color: '#1e3a5f', lineHeight: 1.2, letterSpacing: '-0.01em' }}>
          <b>N</b>ational <b>F</b>ederated <b>C</b>ompute <b>S</b>ervices
          {' – '}
          <em style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic', fontWeight: 400 }}>Arts &amp; Humanities</em>
        </span>
        <span
          style={{ fontSize: 9, color: authorMode ? '#f59e0b' : '#9ca3af', letterSpacing: '0.02em', cursor: 'default', userSelect: 'none' }}
          onClick={handleVersionClick}
          title={authorMode ? 'Author mode ON — click 5× to toggle' : undefined}
        >
          Proof of Concept. V2.0{authorMode ? ' ★' : ''}
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <ExampleMenu onLoad={wf => { try { applyWorkflow(wf) } catch (e) { setLoadError(e instanceof Error ? e.message : 'Failed to load example.') } }} />
      <button
        style={templateBtnStyle}
        onClick={onSave}
        title="Save workflow configuration to a JSON file"
        disabled={nodes.length === 0}
      >
        💾 Save
      </button>
      {authorMode && (
        <button
          style={{ ...templateBtnStyle, background: '#78350f', color: '#fef3c7', borderColor: '#92400e' }}
          onClick={() => setExampleDialog({ title: '', description: '' })}
          title="Save current workflow as a loadable example (author mode)"
          disabled={nodes.length === 0}
        >
          ★ Save as Example
        </button>
      )}
      <button
        style={templateBtnStyle}
        onClick={() => fileInputRef.current?.click()}
        title="Load workflow configuration from a JSON file"
      >
        📂 Load
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={onLoadFile}
      />
      <button
        style={templateBtnStyle}
        onClick={() => {
          if (window.confirm('Clear all notes (prose and structured) in this workflow? This cannot be undone.')) {
            clearAllNotes()
            setNodes(nds => nds.map(n =>
              n.type === 'quickNote' && (n.data as { structuredByRecord?: unknown }).structuredByRecord
                ? { ...n, data: { ...n.data, structuredByRecord: {} } }
                : n))
          }
        }}
        title="Remove every per-record note (prose and structured) in the current workflow"
      >
        🗑 Clear notes
      </button>
      {/* Save-as-example dialog */}
      {exampleDialog && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99998,
          background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#1e2130', border: '1px solid #2d3348', borderRadius: 10,
            padding: 24, minWidth: 360, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Save as Example Workflow</div>
            <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              Title *
              <input
                autoFocus
                value={exampleDialog.title}
                onChange={e => setExampleDialog(d => d ? { ...d, title: e.target.value } : null)}
                placeholder="e.g. GBIF species search"
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid #4b5563', background: '#111827', color: '#e2e8f0', outline: 'none' }}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveExample(); if (e.key === 'Escape') setExampleDialog(null) }}
              />
            </label>
            <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
              Description
              <input
                value={exampleDialog.description}
                onChange={e => setExampleDialog(d => d ? { ...d, description: e.target.value } : null)}
                placeholder="One-line summary of what this workflow demonstrates"
                style={{ fontSize: 12, padding: '5px 8px', borderRadius: 5, border: '1px solid #4b5563', background: '#111827', color: '#e2e8f0', outline: 'none' }}
                onKeyDown={e => { if (e.key === 'Escape') setExampleDialog(null) }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setExampleDialog(null)}
                style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: '1px solid #4b5563', background: 'none', color: '#9ca3af', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveExample}
                disabled={!exampleDialog.title.trim()}
                style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: 'none', background: '#92400e', color: '#fef3c7', cursor: 'pointer', fontWeight: 600 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {(() => {
        const selected = nodes.filter(n => n.selected && n.type !== 'group')
        const groupSelected = nodes.find(n => n.selected && n.type === 'group')
        return (
          <>
            {selected.length >= 2 && (
              <button
                style={templateBtnStyle}
                onClick={onGroupSelected}
                title={`Group ${selected.length} selected nodes`}
              >
                📦 Group ({selected.length})
              </button>
            )}
            {groupSelected && (
              <button
                style={templateBtnStyle}
                onClick={onUngroup}
                title={`Ungroup "${ (groupSelected.data as { name?: string }).name ?? 'Group' }"`}
              >
                📤 Ungroup
              </button>
            )}
            {selected.length > 0 && (
              <span style={{ fontSize: 11, color: '#6b7280', marginRight: 4 }}>
                {selected.length} selected
              </span>
            )}
          </>
        )
      })()}
      {loadError && (
        <span style={{ fontSize: 11, color: '#dc2626', maxWidth: 200 }} title={loadError}>
          ⚠ {loadError}
        </span>
      )}
      <FixtureReferenceCard onPick={onPickCachedSearch} />
      <UsefulLinksModal />
      {import.meta.env.DEV && <FixturePreflightPanel />}
      <button
        style={{ ...templateBtnStyle, background: !simpleMode ? '#312e81' : undefined, color: !simpleMode ? '#fff' : undefined, borderColor: !simpleMode ? '#312e81' : undefined }}
        onClick={onToggleSimpleMode}
        title={simpleMode
          ? 'Simple mode — specialised/alpha nodes hidden. Click for Advanced.'
          : 'Advanced mode — all nodes shown. Click for Simple.'}
      >
        {simpleMode ? '◐ Simple' : '◑ Advanced'}
      </button>
      <button
        style={{ ...templateBtnStyle, background: snapEnabled ? '#0f4c81' : undefined, color: snapEnabled ? '#fff' : undefined, borderColor: snapEnabled ? '#0f4c81' : undefined }}
        onClick={onToggleSnap}
        title={snapEnabled ? 'Grid snap ON — click to disable' : 'Grid snap OFF — click to enable (20px grid)'}
      >
        {snapEnabled ? '⊞ Snap' : '⊟ Snap'}
      </button>
      <button
        style={{ ...templateBtnStyle, background: chatOpen ? '#881337' : undefined, color: chatOpen ? '#fff' : undefined, borderColor: chatOpen ? '#881337' : undefined }}
        onClick={onToggleChat}
        title="Toggle KCL Assistant chat"
      >
        💬 Assistant
      </button>
      <button
        style={{ ...runAllBtnStyle, opacity: runningAll ? 0.6 : 1 }}
        onClick={onRunAll}
        disabled={runningAll}
      >
        {runningAll ? '⏳ Running…' : '▶▶ Run All'}
      </button>
    </div>
  )
}
