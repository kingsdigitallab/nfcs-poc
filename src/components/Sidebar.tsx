/**
 * Sidebar — the node palette with search, collapsible TaDiRAH groups, and
 * the Experimental section, extracted verbatim from App.tsx (task 5.6).
 * Search text and collapsed-group state are internal — only simpleMode is
 * shared with the rest of the app.
 */
import { useState } from 'react'
import {
  SIDEBAR_ITEMS, SIDEBAR_GROUPS, DEFAULT_COLLAPSED_GROUPS, ADVANCED_TYPES,
} from '../config/sidebarItems'
import { sidebarStyle, sidebarHeading, sidebarItemStyle, sidebarDot } from '../styles/appStyles'

export function Sidebar({ simpleMode }: { simpleMode: boolean }) {
  const [nodeQuery, setNodeQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set(DEFAULT_COLLAPSED_GROUPS))

  return (
    <div style={sidebarStyle}>
      {/* Node search — sticky, pinned while the list scrolls */}
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#f8f3e9', paddingBottom: 6 }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            value={nodeQuery}
            onChange={e => setNodeQuery(e.target.value)}
            placeholder="Search nodes…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '6px 22px 6px 8px', fontSize: 12,
              border: '1px solid #ece3d0', borderRadius: 6, outline: 'none',
            }}
          />
          {nodeQuery && (
            <button
              type="button"
              onClick={() => setNodeQuery('')}
              title="Clear search"
              style={{
                position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 12, color: '#b0a891', lineHeight: 1, padding: 2,
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {SIDEBAR_GROUPS.map(group => {
        const q = nodeQuery.trim().toLowerCase()
        const searching = q.length > 0
        const isExperimental = group === 'Experimental'
        // Experimental group is entirely hidden in Simple mode
        if (isExperimental && simpleMode) return null
        const items = SIDEBAR_ITEMS.filter(
          i => i.group === group && !i.hidden && (!simpleMode || !ADVANCED_TYPES.has(i.type)) &&
            (!searching
              || i.label.toLowerCase().includes(q)
              || i.sub.toLowerCase().includes(q)
              || i.type.toLowerCase().includes(q)),
        )
        // While searching, hide groups with no matches for a clean list
        if (searching && items.length === 0) return null
        // While searching, force-expand so matches in collapsed groups show
        const isCollapsed = searching ? false : collapsedGroups.has(group)
        const toggleGroup = () => setCollapsedGroups(prev => {
          const next = new Set(prev)
          next.has(group) ? next.delete(group) : next.add(group)
          return next
        })
        return (
          <div key={group} style={isExperimental ? { borderLeft: '3px solid #f59e0b', paddingLeft: 4, marginTop: 4 } : undefined}>
            <div
              style={{ ...sidebarHeading, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              onClick={toggleGroup}
            >
              <span>{isExperimental ? '⚗ Experimental' : group}</span>
              <span style={{ fontSize: 9, color: '#d6ccb5' }}>{isCollapsed ? '▶' : '▼'}</span>
            </div>
            {isExperimental && !isCollapsed && (
              <div style={{ fontSize: 9, color: '#d97706', fontStyle: 'italic', padding: '0 4px 4px', lineHeight: 1.4 }}>
                These nodes may change behaviour between releases.
              </div>
            )}
            {!isCollapsed && items.map(item => (
              <div
                key={item.type}
                style={{ ...sidebarItemStyle, opacity: item.deprecated ? 0.55 : 1 }}
                draggable
                onDragStart={e => e.dataTransfer.setData('application/reactflow', item.type)}
                title={item.deprecated ? 'Deprecated — service currently unavailable' : undefined}
              >
                <div style={{ ...sidebarDot, background: item.color }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12, textDecoration: item.deprecated ? 'line-through' : 'none', color: item.deprecated ? '#b0a891' : undefined }}>
                    {item.label}
                    {item.deprecated && <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: '#ef4444', textDecoration: 'none', verticalAlign: 'middle' }}>DEPRECATED</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#b0a891', marginTop: 2 }}>{item.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )
      })}
      <div style={{ flex: 1 }} />
      <div style={{ fontSize: 10, color: '#d6ccb5', padding: '4px', lineHeight: 1.4 }}>
        Double-click a Table or JSON node to expand it
      </div>
    </div>
  )
}
