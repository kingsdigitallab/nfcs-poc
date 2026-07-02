import type React from 'react'

export const attributionStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(4px)',
  border: '1px solid #e5e7eb', borderRadius: 4,
  padding: '3px 8px', fontSize: 10, color: '#9ca3af',
  fontFamily: 'inherit', letterSpacing: '0.01em',
  pointerEvents: 'none',
}

export const topBarStyle: React.CSSProperties = {
  height: 40, background: '#fff', borderBottom: '1px solid #e5e7eb',
  display: 'flex', alignItems: 'center', gap: 16, padding: '0 16px', flexShrink: 0,
}

export const templateBtnStyle: React.CSSProperties = {
  background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6,
  padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
}

export const runAllBtnStyle: React.CSSProperties = {
  background: '#0f4c81', color: '#fff', border: 'none', borderRadius: 6,
  padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}

export const sidebarStyle: React.CSSProperties = {
  width: 184, background: '#fff', borderRight: '1px solid #e5e7eb',
  display: 'flex', flexDirection: 'column', padding: '12px 8px', gap: 6, flexShrink: 0,
  overflowY: 'auto',
}

export const sidebarHeading: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#9ca3af',
  textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 4px', marginBottom: 2,
}

export const sidebarItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
  borderRadius: 6, border: '1px solid #e5e7eb', cursor: 'grab', userSelect: 'none',
}

export const sidebarDot: React.CSSProperties = {
  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
}

export const debugOuter: React.CSSProperties = {
  background: '#1e1e1e', color: '#d4d4d4', borderTop: '1px solid #333',
  flexShrink: 0, maxHeight: 200, display: 'flex', flexDirection: 'column',
}

export const debugToggle: React.CSSProperties = {
  background: '#2d2d2d', border: 'none', color: '#9ca3af', fontSize: 11,
  padding: '4px 10px', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
}

export const debugPre: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', overflowY: 'auto', flex: 1, margin: 0,
}
