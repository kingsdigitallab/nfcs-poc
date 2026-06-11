import { useState } from 'react'
import type { PromptRecipe } from '../hooks/usePromptRecipes'

interface PromptRecipeBarProps {
  nodeFamily: 'standard' | 'field'
  mode?:      'per-record' | 'aggregate'
  onApply:    (recipe: PromptRecipe) => void
  onSave:     (name: string) => void
  onDelete:   (id: string) => void
  recipes:    PromptRecipe[]
}

export function PromptRecipeBar({ nodeFamily, mode, onApply, onSave, onDelete, recipes }: PromptRecipeBarProps) {
  const [selectedId, setSelectedId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')

  // Filter recipes for this node type
  const filtered = recipes.filter(r => {
    if (r.nodeFamily !== nodeFamily) return false
    if (nodeFamily === 'field' && mode && r.mode !== mode) return false
    return true
  })

  const selected = filtered.find(r => r.id === selectedId)
  const isBuiltIn = selected?.builtIn === true

  const handleApply = () => {
    if (selected) {
      onApply(selected)
      setSaveName(selected.name)
    }
  }

  const handleSaveClick = () => {
    setSaveName(selected?.name ?? '')
    setSaving(true)
  }

  const handleSaveConfirm = () => {
    if (saveName.trim()) {
      onSave(saveName.trim())
      setSaving(false)
      setSaveName('')
    }
  }

  const handleDeleteClick = () => {
    if (selected && window.confirm(`Delete recipe "${selected.name}"?`)) {
      onDelete(selected.id)
      setSelectedId('')
    }
  }

  return (
    <div style={S.container} className="nodrag">
      <select
        value={selectedId}
        onChange={e => {
          setSelectedId(e.target.value)
          setSaving(false)
          setSaveName('')
        }}
        style={S.select}
        className="nodrag"
      >
        <option value="">
          {filtered.length === 0
            ? '— no recipes saved —'
            : '— select a recipe —'}
        </option>
        {filtered.map(r => (
          <option key={r.id} value={r.id}>
            {r.builtIn ? '★ ' : ''}{r.name}
          </option>
        ))}
      </select>

      {saving ? (
        <>
          <input
            type="text"
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            placeholder="recipe name"
            style={S.input}
            className="nodrag"
            autoFocus
          />
          <button
            onClick={handleSaveConfirm}
            style={{ ...S.button, ...S.confirmBtn }}
            className="nodrag"
            title="Save recipe"
          >
            ✓
          </button>
        </>
      ) : (
        <>
          <button
            onClick={handleApply}
            disabled={!selected}
            style={{ ...S.button, opacity: selected ? 1 : 0.5 }}
            className="nodrag"
            title={selected ? 'Apply recipe' : 'Select a recipe first'}
          >
            Apply
          </button>

          <button
            onClick={handleSaveClick}
            style={S.button}
            className="nodrag"
            title="Save current prompts as a new recipe"
          >
            Save…
          </button>

          {selected && !isBuiltIn && (
            <button
              onClick={handleDeleteClick}
              style={{ ...S.button, ...S.deleteBtn }}
              className="nodrag"
              title="Delete recipe"
            >
              🗑
            </button>
          )}
        </>
      )}
    </div>
  )
}

const S = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    padding: '4px 0',
    marginBottom: 6,
    borderBottom: '1px dashed #d1d5db',
  } as const,

  select: {
    flex: 1,
    fontSize: 11,
    padding: '2px 3px',
    border: '1px solid #d1d5db',
    borderRadius: 3,
    background: '#f9fafb',
    outline: 'none' as const,
    height: 22,
  } as const,

  input: {
    flex: 1,
    fontSize: 11,
    padding: '2px 4px',
    border: '1px solid #d1d5db',
    borderRadius: 3,
    background: '#f9fafb',
    outline: 'none' as const,
    height: 22,
  } as const,

  button: {
    background: 'none',
    border: '1px solid #d1d5db',
    borderRadius: 3,
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: 10,
    padding: '2px 6px',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  } as const,

  confirmBtn: {
    color: '#10b981',
    borderColor: '#10b981',
    fontWeight: 600,
  } as const,

  deleteBtn: {
    color: '#ef4444',
    borderColor: '#fecaca',
  } as const,
}
