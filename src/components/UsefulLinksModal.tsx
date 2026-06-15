import { useState } from 'react'
import { TADIRAHMapping } from './TADIRAHMapping'

const REPO_URL    = 'https://github.com/kingsdigitallab/nfcs-poc'
const PDF_URL     = 'https://github.com/kingsdigitallab/nfcs-poc/blob/main/workshop-scenarios.pdf'
const VIDEOS_URL  = 'https://media.kcl.ac.uk/playlist/dedicated/1_byz38x11/1_kx4vwr4g'

type Tab = 'links' | 'tadirah'

export function UsefulLinksModal() {
  const [open, setOpen] = useState(false)
  const [tab, setTab]   = useState<Tab>('links')

  if (!open) {
    return (
      <button style={S.trigger} onClick={() => setOpen(true)} title="Useful links and resources">
        🔗 Useful links
      </button>
    )
  }

  return (
    <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}>
      <div style={S.modal}>
        {/* Modal header */}
        <div style={S.header}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={S.headerTitle}>Useful links</span>
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              {([['links', '🔗 Links'], ['tadirah', '📊 TaDiRAH']] as [Tab, string][]).map(([t, label]) => (
                <button
                  key={t}
                  style={{ ...S.tabBtn, ...(tab === t ? S.tabBtnActive : {}) }}
                  onClick={() => setTab(t)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button style={S.closeBtn} onClick={() => setOpen(false)} title="Close">✕</button>
        </div>

        {/* Content */}
        {tab === 'links' ? (
          <div style={S.linksBody}>
            <LinkCard
              icon="💻"
              title="Source repository"
              url={REPO_URL}
              desc="GitHub — kingsdigitallab/nfcs-poc"
            />
            <LinkCard
              icon="📄"
              title="Workshop scenarios"
              url={PDF_URL}
              desc="Step-by-step guided scenarios for the workshop (PDF)"
            />
            <LinkCard
              icon="🎬"
              title="Instructional videos"
              url={VIDEOS_URL}
              desc="KCL Media — video walkthroughs of the proof-of-concept interface"
            />
          </div>
        ) : (
          <TADIRAHMapping />
        )}
      </div>
    </div>
  )
}

function LinkCard({ icon, title, url, desc }: { icon: string; title: string; url: string; desc: string }) {
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

const S: Record<string, React.CSSProperties> = {
  trigger: {
    background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db',
    borderRadius: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  overlay: {
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: 60,
  },
  modal: {
    background: '#fff', borderRadius: 10,
    boxShadow: '0 16px 48px rgba(0,0,0,0.3)',
    width: '90vw', maxWidth: 900,
    maxHeight: '85vh',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid #e5e7eb',
    flexShrink: 0, background: '#1B2A4A',
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 14 },
  tabBtn: {
    padding: '4px 12px', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: 5, background: 'transparent', color: 'rgba(255,255,255,0.7)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
  tabBtnActive: {
    background: 'rgba(255,255,255,0.15)', color: '#fff',
    borderColor: 'rgba(255,255,255,0.5)',
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
    padding: '16px 18px', border: '1.5px solid #e5e7eb', borderRadius: 8,
    textDecoration: 'none', color: 'inherit', background: '#f9fafb',
    transition: 'border-color 0.15s, background 0.15s',
  },
  cardIcon:  { fontSize: 24, flexShrink: 0, lineHeight: 1, marginTop: 2 },
  cardText:  { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 2 },
  cardDesc:  { fontSize: 12, color: '#6b7280', marginBottom: 4, lineHeight: 1.4 },
  cardUrl:   { fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', wordBreak: 'break-all' },
  cardArrow: { fontSize: 18, color: '#9ca3af', flexShrink: 0, alignSelf: 'center' },
}
