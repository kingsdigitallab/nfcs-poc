import { useState } from 'react'
import { TADIRAHMapping } from './TADIRAHMapping'

const REPO_URL   = 'https://github.com/kingsdigitallab/nfcs-poc'
const PDF_URL    = 'https://github.com/kingsdigitallab/nfcs-poc/blob/main/workshop-scenarios.pdf'
const VIDEOS_URL = 'https://media.kcl.ac.uk/playlist/dedicated/1_byz38x11/1_kx4vwr4g'

export function UsefulLinksModal() {
  const [open, setOpen]           = useState(false)
  const [showTadirah, setShowTadirah] = useState(false)

  if (!open) {
    return (
      <button style={S.trigger} onClick={() => setOpen(true)} title="Useful links and resources">
        🔗 Useful links
      </button>
    )
  }

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) { setOpen(false); setShowTadirah(false) } }}>
      <div style={S.modal}>
        {/* Header */}
        <div style={S.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {showTadirah && (
              <button style={S.backBtn} onClick={() => setShowTadirah(false)} title="Back to links">
                ← Back
              </button>
            )}
            <span style={S.headerTitle}>
              {showTadirah ? 'PoC Node Registry → TaDiRAH Mapping' : 'Useful links'}
            </span>
          </div>
          <button style={S.closeBtn} onClick={() => { setOpen(false); setShowTadirah(false) }} title="Close">✕</button>
        </div>

        {/* Content */}
        {showTadirah ? (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            <TADIRAHMapping />
          </div>
        ) : (
          <div style={S.linksBody}>
            <ExternalCard
              icon="💻"
              title="Source repository"
              url={REPO_URL}
              desc="GitHub — kingsdigitallab/nfcs-poc"
            />
            <ExternalCard
              icon="📄"
              title="Workshop scenarios"
              url={PDF_URL}
              desc="Step-by-step guided scenarios for the workshop (PDF)"
            />
            <ExternalCard
              icon="🎬"
              title="Instructional videos"
              url={VIDEOS_URL}
              desc="KCL Media — video walkthroughs of the proof-of-concept interface"
            />
            <InternalCard
              icon="📊"
              title="TaDiRAH mapping"
              desc="PoC nodes mapped to the Taxonomy of Digital Research Activities in the Humanities (TaDiRAH 2.0)"
              onClick={() => setShowTadirah(true)}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ExternalCard({ icon, title, url, desc }: { icon: string; title: string; url: string; desc: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" style={S.card}>
      <span style={S.cardIcon}>{icon}</span>
      <div style={S.cardText}>
        <div style={S.cardTitle}>{title}</div>
        <div style={S.cardDesc}>{desc}</div>
        <div style={S.cardUrl}>{url}</div>
      </div>
      <span style={S.cardArrow}>↗</span>
    </a>
  )
}

function InternalCard({ icon, title, desc, onClick }: { icon: string; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...S.card, cursor: 'pointer', textAlign: 'left', width: '100%' }}>
      <span style={S.cardIcon}>{icon}</span>
      <div style={S.cardText}>
        <div style={S.cardTitle}>{title}</div>
        <div style={S.cardDesc}>{desc}</div>
      </div>
      <span style={S.cardArrow}>→</span>
    </button>
  )
}

const S: Record<string, React.CSSProperties> = {
  trigger: {
    background: '#f3f4f6', color: '#33302a', border: '1px solid #d6ccb5',
    borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: 60,
  },
  modal: {
    background: '#fffdf7', borderRadius: 10,
    boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
    width: '90vw', maxWidth: 900,
    maxHeight: '85vh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #ece3d0',
    flexShrink: 0, background: '#1B2A4A',
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 14 },
  backBtn: {
    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 5, color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: 600,
    cursor: 'pointer', padding: '3px 10px',
  },
  closeBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
    cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '2px 4px',
  },
  linksBody: {
    padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
  },
  card: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    padding: '16px 18px', border: '1.5px solid #ece3d0', borderRadius: 8,
    textDecoration: 'none', color: 'inherit', background: '#faf6ec',
  },
  cardIcon:  { fontSize: 24, flexShrink: 0, lineHeight: 1, marginTop: 2 },
  cardText:  { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#2c2a24', marginBottom: 2 },
  cardDesc:  { fontSize: 12, color: '#8a8168', marginBottom: 4, lineHeight: 1.4 },
  cardUrl:   { fontSize: 10, color: '#b0a891', fontFamily: 'monospace', wordBreak: 'break-all' },
  cardArrow: { fontSize: 18, color: '#b0a891', flexShrink: 0, alignSelf: 'center' },
}
