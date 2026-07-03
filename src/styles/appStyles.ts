/* ============================================================================
   appStyles.ts — "Archive" makeover. Drop-in replacement for
   src/styles/appStyles.ts. Shell chrome: top bar, sidebar, Run All, debug bar,
   attribution. Imports tokens from theme.ts (adjust the relative path if you
   place theme.ts somewhere other than src/styles/).
   ========================================================================== */

import type React from 'react'
import { NEUTRAL, ACCENT, FONT, RADIUS } from './theme'

export const attributionStyle: React.CSSProperties = {
  background: 'rgba(255,253,247,0.75)', backdropFilter: 'blur(4px)',
  border: `1px solid ${NEUTRAL.chromeBorder}`, borderRadius: 4,
  padding: '3px 8px', fontSize: 10, color: NEUTRAL.faint,
  fontFamily: FONT.serif, fontStyle: 'italic', letterSpacing: '0.01em',
  pointerEvents: 'none',
}

export const topBarStyle: React.CSSProperties = {
  height: 58, background: NEUTRAL.chrome, borderBottom: `1px solid ${NEUTRAL.chromeBorder}`,
  display: 'flex', alignItems: 'center', gap: 14, padding: '0 18px', flexShrink: 0,
}

export const templateBtnStyle: React.CSSProperties = {
  background: NEUTRAL.card, color: '#4a4636', border: `1px solid #e0d6c1`, borderRadius: RADIUS.button,
  padding: '7px 12px', fontSize: 12.5, fontWeight: 500, cursor: 'pointer',
  fontFamily: FONT.sans,
}

export const runAllBtnStyle: React.CSSProperties = {
  background: ACCENT.action, color: ACCENT.actionFg, border: 'none', borderRadius: RADIUS.button,
  padding: '7px 15px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: FONT.sans,
}

export const sidebarStyle: React.CSSProperties = {
  width: 214, background: NEUTRAL.chrome, borderRight: `1px solid ${NEUTRAL.chromeBorder}`,
  display: 'flex', flexDirection: 'column', padding: '12px 10px', gap: 5, flexShrink: 0,
  overflowY: 'auto',
}

export const sidebarHeading: React.CSSProperties = {
  fontFamily: FONT.serif, fontSize: 11, fontWeight: 600, color: NEUTRAL.muted,
  textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 4px', marginBottom: 2,
}

export const sidebarItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 9, padding: '8px 9px',
  borderRadius: RADIUS.button, border: `1px solid ${NEUTRAL.hairline}`, background: NEUTRAL.card,
  cursor: 'grab', userSelect: 'none',
}

export const sidebarDot: React.CSSProperties = {
  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
}

/* Debug bar — left dark by request (no change to the debug surface). */
export const debugOuter: React.CSSProperties = {
  background: '#1e1e1e', color: '#d4d4d4', borderTop: '1px solid #333',
  flexShrink: 0, maxHeight: 200, display: 'flex', flexDirection: 'column',
}

export const debugToggle: React.CSSProperties = {
  background: '#2d2d2d', border: 'none', color: '#9ca3af', fontSize: 11,
  padding: '4px 10px', cursor: 'pointer', textAlign: 'left', flexShrink: 0,
  fontFamily: FONT.mono,
}

export const debugPre: React.CSSProperties = {
  fontSize: 11, padding: '6px 10px', overflowY: 'auto', flex: 1, margin: 0,
  fontFamily: FONT.mono,
}
