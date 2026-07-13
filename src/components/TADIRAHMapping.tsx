import { useState } from 'react'

// ── Data ────────────────────────────────────────────────────────────────────

const TADIRAH = [
  {
    id: 'capture',
    label: 'Capture',
    color: '#0C6E72',
    bg: '#EAF6F7',
    border: '#9DD5D7',
    description: 'Locating, collecting and importing research material',
    activities: [
      {
        name: 'Discovering',
        nodes: [
          { label: 'ARIADNESearch', note: 'Cross-European archaeology portal' },
          { label: 'HSDSSearch', note: 'UK heritage science aggregator' },
          { label: 'BodleianSearch', note: 'Digitised manuscript catalogue' },
          { label: 'EuropeanaSearch', note: 'Pan-European cultural heritage' },
          { label: 'GBIFSearch', note: 'Global biodiversity occurrences' },
          { label: 'LLDSSearch', note: 'Literary & linguistic archive' },
          { label: 'MDSSearch', note: 'UK museum collections' },
        ],
      },
      {
        name: 'Gathering',
        nodes: [
          { label: 'LocalFolderSource', note: 'Local corpora — TEI, PDF, images' },
          { label: 'LocalFileSource', note: 'Single local file ingestion' },
          { label: 'URLContentFetch', note: 'Web page retrieval' },
          { label: 'LoadSavedSearch', note: 'Reload a serialised result set' },
        ],
      },
      {
        name: 'Imaging',
        nodes: [
          { label: 'ImageView / IIIF', note: 'Browse & annotate digitised manuscripts' },
        ],
      },
      {
        name: 'Data Recognition',
        nodes: [
          { label: 'XMLExtract', note: 'XPath extraction from TEI/XML sources' },
          { label: 'HTMLExtract', note: 'CSS-selector extraction from web pages' },
        ],
      },
    ],
  },
  {
    id: 'enrichment',
    label: 'Enrichment',
    color: '#6B3FA0',
    bg: '#F3EEF9',
    border: '#C9B3E8',
    description: 'Adding value to, and normalising, existing data',
    activities: [
      {
        name: 'Annotating',
        nodes: [
          { label: 'KingsInference', note: 'Per-record AI analysis, vision-capable' },
          { label: 'KingsInferenceByField', note: 'Per-field or aggregate AI annotation' },
        ],
      },
      {
        name: 'Georeferencing',
        nodes: [
          { label: 'Geocoding', note: 'Getty TGN + Wikidata gazetteer resolution' },
          { label: 'SmartGeocoder', note: 'LLM-assisted place extraction then geocoding' },
        ],
      },
      {
        name: 'Linking',
        nodes: [
          { label: 'Reconciliation', note: 'Match fields against Wikidata authorities' },
          { label: 'WikidataEnrich', note: 'Pull structured properties for matched QIDs' },
          { label: 'MergeByQID', note: 'Merge cross-service records by shared entity' },
        ],
      },
      {
        name: 'Cleanup',
        nodes: [
          { label: 'FilterTransform (Transform)', note: 'Rename, normalise, truncate, extract fields' },
          { label: 'Deduplicate', note: 'Remove duplicate records by chosen field' },
        ],
      },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis',
    color: '#1A5FA8',
    bg: '#EBF3FC',
    border: '#9FC6EE',
    description: 'Interrogating and exploring aggregated data',
    activities: [
      {
        name: 'Content Analysis',
        nodes: [
          { label: 'FilterTransform (Filter)', note: 'Rule-based record filtering' },
          { label: 'SmartFilter', note: 'Natural-language filter — LLM writes the rules' },
          { label: 'SourceProfile', note: 'Schema completeness & field distribution per source' },
        ],
      },
      {
        name: 'Statistical Analysis',
        nodes: [
          { label: 'FieldDistribution', note: 'Click-to-facet value frequency chart' },
          { label: 'SourceProfile', note: 'Record count and field coverage statistics' },
        ],
      },
      {
        name: 'Geospatial Analysis',
        nodes: [
          { label: 'SpatialFilter', note: 'Bounding-box filter on a Leaflet map' },
          { label: 'MapOutput', note: 'Map plot with integrated bbox filter' },
        ],
      },
      {
        name: 'Thematic Analysis',
        nodes: [
          { label: 'TimelineView', note: 'Temporal distribution + drag-to-filter range' },
          { label: 'FieldDistribution', note: 'Subject / type faceting across result sets' },
        ],
      },
      {
        name: 'Visual Analysis',
        nodes: [
          { label: 'ImageView / IIIF', note: 'Region annotation → crop → vision inference' },
        ],
      },
      {
        name: 'Relational Analysis',
        nodes: [
          { label: 'MergeByQID', note: 'Cross-service entity co-occurrence via QID' },
          { label: 'Reconciliation', note: 'Authority-matched linking across domains' },
        ],
      },
    ],
  },
  {
    id: 'interpretation',
    label: 'Interpretation',
    color: '#3B3D9A',
    bg: '#EEEEF9',
    border: '#B3B4E8',
    description: 'Reasoning over results towards research conclusions',
    activities: [
      {
        name: 'Contextualizing',
        nodes: [
          { label: 'SourceProfile (AI narrative)', note: 'AI summary of a result set against a stated research question' },
          { label: 'KingsInferenceByField (aggregate)', note: 'Synthesise across all records in a single prompt' },
        ],
      },
      {
        name: 'Identifying',
        nodes: [
          { label: 'Reconciliation', note: 'Entity identification against Wikidata authorities' },
          { label: 'WikidataEnrich', note: 'Resolve QIDs to structured entity properties' },
          { label: 'QuickView', note: 'Inspect individual field values across records' },
        ],
      },
      {
        name: 'Modeling',
        nodes: [
          { label: 'QuickStart', note: 'Research question → instantiated node workflow' },
          { label: 'SmartFilter', note: 'Plain-English criterion → reproducible filter rule' },
        ],
      },
    ],
  },
  {
    id: 'storage',
    label: 'Storage',
    color: '#3D6B4F',
    bg: '#EBF5EF',
    border: '#9FD0B2',
    description: 'Preserving and managing workflows and result sets',
    activities: [
      {
        name: 'Organizing',
        nodes: [
          { label: 'SaveSearch', note: 'Serialise full workflow to portable .nfcs.json' },
          { label: 'LoadSavedSearch', note: 'Restore a saved workflow and its results' },
        ],
      },
      {
        name: 'Archiving',
        nodes: [
          { label: 'Export', note: 'Download result sets as CSV, JSON, or GeoJSON' },
          { label: 'SaveSearch', note: 'Snapshot records with provenance envelope' },
        ],
      },
    ],
  },
  {
    id: 'dissemination',
    label: 'Dissemination',
    color: '#7A4012',
    bg: '#FBF1EA',
    border: '#E8B98A',
    description: 'Sharing, citing and publishing results',
    activities: [
      {
        name: 'Sharing',
        nodes: [
          { label: 'Export', note: 'CSV / JSON / GeoJSON download' },
          { label: 'TableOutput', note: 'Sortable, filterable result table' },
          { label: 'JSONOutput', note: 'Raw JSON record viewer' },
          { label: 'SaveSearch', note: 'Shareable workflow-and-data snapshot' },
        ],
      },
      {
        name: 'Publishing',
        nodes: [
          { label: 'Citation', note: 'Formatted reference list from federated results' },
          { label: 'MapOutput', note: 'Embeddable map visualisation of spatial records' },
        ],
      },
      {
        name: 'Commenting',
        nodes: [
          { label: 'Comment', note: 'Free-floating workflow annotation node' },
        ],
      },
    ],
  },
]

const GAPS = [
  { category: 'Creation', reason: 'Programming and writing new artefacts is out of scope — the PoC consumes and processes existing data' },
  { category: 'Storage → Preservation', reason: 'Long-term digital preservation is infrastructure-layer work addressed by sibling NFCS projects (Projects 10, 16)' },
  { category: 'Dissemination → Crowdsourcing', reason: 'No multi-user annotation or collaborative workspace (see Project 2 for future registry work)' },
  { category: 'Analysis → Network Analysis', reason: 'Graph-based relationship mapping not yet implemented (MergeByQID covers co-occurrence only)' },
  { category: 'Analysis → Stylistic Analysis', reason: 'Computational stylistics (authorship, register) possible via KingsInference prompts but not a dedicated node' },
]

// ── Component ────────────────────────────────────────────────────────────────

interface NodeEntry { label: string; note: string }
interface NodeWithMappings extends NodeEntry { mappings: { cat: string; color: string; bg: string; activity: string }[] }

export function TADIRAHMapping() {
  const [view, setView]               = useState<'tadirah' | 'nodes'>('tadirah')
  const [expandedCat, setExpandedCat] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<NodeEntry | null>(null)

  const allNodes: Record<string, NodeWithMappings> = {}
  TADIRAH.forEach(cat => {
    cat.activities.forEach(act => {
      act.nodes.forEach(n => {
        if (!allNodes[n.label]) allNodes[n.label] = { label: n.label, note: n.note, mappings: [] }
        allNodes[n.label].mappings.push({ cat: cat.label, color: cat.color, bg: cat.bg, activity: act.name })
      })
    })
  })
  const nodeList = Object.values(allNodes).sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', background: '#F5F4F0', minHeight: 0 }}>
      {/* Header */}
      <div style={{ background: '#1B2A4A', color: '#fff', padding: '24px 32px 20px' }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#9BB5D4', marginBottom: 6 }}>
          NFCS NetworkPlus · Project 11 · King's Digital Lab
        </div>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
          PoC Node Registry → TaDiRAH Mapping
        </h2>
        <p style={{ margin: '8px 0 0', fontSize: 12, color: '#B8CCE0', maxWidth: 640 }}>
          Each node mapped to the{' '}
          <strong style={{ color: '#fff' }}>Taxonomy of Digital Research Activities in the Humanities (TaDiRAH 2.0)</strong>.
          The PoC spans five of the seven top-level activity categories; gaps noted below.
        </p>
        {/* Lifecycle strip */}
        <div style={{ display: 'flex', gap: 0, marginTop: 16, flexWrap: 'wrap' }}>
          {[
            { label: 'Capture',         covered: true,  color: '#0C6E72' },
            { label: 'Creation',        covered: false, color: '#888'    },
            { label: 'Enrichment',      covered: true,  color: '#6B3FA0' },
            { label: 'Analysis',        covered: true,  color: '#1A5FA8' },
            { label: 'Interpretation',  covered: true,  color: '#3B3D9A' },
            { label: 'Storage',         covered: true,  color: '#3D6B4F' },
            { label: 'Dissemination',   covered: true,  color: '#7A4012' },
          ].map((item, i, arr) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                padding: '4px 10px',
                background: item.covered ? item.color : 'transparent',
                border: `1.5px solid ${item.covered ? item.color : '#555'}`,
                color: item.covered ? '#fff' : '#666',
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.05em',
                opacity: item.covered ? 1 : 0.55,
                borderRadius: i === 0 ? '4px 0 0 4px' : i === arr.length - 1 ? '0 4px 4px 0' : 0,
                borderLeft: i > 0 ? 'none' : undefined,
              }}>
                {item.label}
              </div>
              {i < arr.length - 1 && (
                <div style={{ width: 9, height: 0, borderTop: '9px solid transparent', borderBottom: '9px solid transparent', borderLeft: `5px solid ${item.covered ? item.color : '#333'}`, marginLeft: -1, zIndex: 1 }} />
              )}
            </div>
          ))}
          <div style={{ marginLeft: 14, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: '#9BB5D4' }}>
            <span>■ covered</span>
            <span style={{ opacity: 0.55 }}>□ out of scope</span>
          </div>
        </div>
      </div>

      {/* View toggle */}
      <div style={{ padding: '12px 32px', display: 'flex', gap: 8, borderBottom: '1px solid #DDD9D0', background: '#EDECE8', alignItems: 'center' }}>
        {(['tadirah', 'nodes'] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            padding: '5px 14px',
            border: '1.5px solid',
            borderColor: view === v ? '#1B2A4A' : '#C8C4BB',
            borderRadius: 4,
            background: view === v ? '#1B2A4A' : 'transparent',
            color: view === v ? '#fff' : '#4A4640',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
          }}>
            {v === 'tadirah' ? 'By TaDiRAH activity' : 'By PoC node'}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#7A7268' }}>
          {nodeList.length} distinct nodes · {TADIRAH.length} TaDiRAH categories covered
        </span>
      </div>

      <div style={{ padding: '20px 32px', overflowY: 'auto', maxHeight: '55vh' }}>
        {view === 'tadirah' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {TADIRAH.map(cat => (
                <div key={cat.id} style={{ background: '#fffdf7', border: `1.5px solid ${cat.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div
                    style={{ background: cat.color, padding: '8px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}
                    onClick={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
                  >
                    <div>
                      <div style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>{cat.label}</div>
                      <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, marginTop: 2 }}>{cat.description}</div>
                    </div>
                    <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginLeft: 8, flexShrink: 0 }}>
                      {expandedCat === cat.id ? '▲' : '▼'}
                    </div>
                  </div>
                  {(expandedCat === null || expandedCat === cat.id) && (
                    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {cat.activities.map(act => (
                        <div key={act.name}>
                          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: cat.color, marginBottom: 5 }}>
                            {act.name}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {act.nodes.map(node => (
                              <div
                                key={node.label}
                                title={node.note}
                                onMouseEnter={() => setHoveredNode(node)}
                                onMouseLeave={() => setHoveredNode(null)}
                                style={{ padding: '2px 8px', background: cat.bg, border: `1px solid ${cat.border}`, borderRadius: 20, fontSize: 10, fontWeight: 500, color: cat.color, cursor: 'default', whiteSpace: 'nowrap' }}
                              >
                                {node.label}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {hoveredNode && (
              <div style={{ marginTop: 10, padding: '6px 12px', background: '#1B2A4A', color: '#fff', borderRadius: 6, fontSize: 11, maxWidth: 480 }}>
                <strong>{hoveredNode.label}</strong> — {hoveredNode.note}
              </div>
            )}

            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7A7268', marginBottom: 8 }}>
                Coverage gaps — TaDiRAH activities not addressed
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {GAPS.map(g => (
                  <div key={g.category} style={{ display: 'flex', gap: 8, padding: '6px 10px', background: '#fffdf7', border: '1px solid #E0DDD6', borderRadius: 6, fontSize: 11 }}>
                    <span style={{ fontWeight: 600, color: '#4A4640', flexShrink: 0 }}>{g.category}</span>
                    <span style={{ color: '#7A7268' }}>— {g.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
            {nodeList.map(node => (
              <div key={node.label} style={{ background: '#fffdf7', border: '1px solid #E0DDD6', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ padding: '7px 10px', borderBottom: '1px solid #EAE8E2' }}>
                  <div style={{ fontWeight: 700, fontSize: 12, color: '#1B2A4A' }}>{node.label}</div>
                  <div style={{ fontSize: 10, color: '#7A7268', marginTop: 2 }}>{node.note}</div>
                </div>
                <div style={{ padding: '5px 10px 7px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                  {node.mappings.map((m, i) => (
                    <div key={i} style={{ padding: '1px 7px', background: m.bg, border: `1px solid ${m.color}44`, borderRadius: 20, fontSize: 9, fontWeight: 600, color: m.color, whiteSpace: 'nowrap' }}>
                      {m.cat} · {m.activity}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '0 32px 12px' }}>
        <div style={{ borderTop: '1px solid #DDD9D0', paddingTop: 10, fontSize: 9, color: '#A09A90', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 }}>
          <span>TaDiRAH 2.0 · Borek, Hastik, Khramova, Geiger (2021) · <em>vocabs.dariah.eu/tadirah</em></span>
          <span>github.com/kingsdigitallab/nfcs-poc · Neil Jakeman, King's Digital Lab</span>
        </div>
      </div>
    </div>
  )
}
