/**
 * Wikidata wbgetentities API client.
 * CORS is permitted by Wikidata via the origin=* parameter — no proxy needed.
 */

const WD_API   = 'https://www.wikidata.org/w/api.php'
const BATCH_SZ = 50

// ─── property catalogue ───────────────────────────────────────────────────────

export interface PropertyDef {
  id:    string
  label: string
  field: string   // camelCase field name suffix used in wd_* output
}

export interface PropertyGroup {
  label:      string
  properties: PropertyDef[]
}

export const PROPERTY_GROUPS: PropertyGroup[] = [
  {
    label: 'General',
    properties: [
      { id: 'P31',  label: 'instance of',     field: 'instanceOf'     },
      { id: 'P17',  label: 'country',          field: 'country'        },
      { id: 'P571', label: 'inception',        field: 'inception'      },
      { id: 'P576', label: 'dissolved',        field: 'dissolved'      },
      { id: 'P856', label: 'official website', field: 'officialWebsite'},
      { id: 'P18',  label: 'image',            field: 'image'          },
    ],
  },
  {
    label: 'Taxon',
    properties: [
      { id: 'P171',  label: 'parent taxon',   field: 'parentTaxon'   },
      { id: 'P141',  label: 'IUCN status',    field: 'IUCNStatus'    },
      { id: 'P105',  label: 'taxon rank',     field: 'taxonRank'     },
      { id: 'P225',  label: 'taxon name',     field: 'taxonName'     },
      { id: 'P1843', label: 'common name',    field: 'commonName'    },
      { id: 'P685',  label: 'NCBI taxon ID',  field: 'NCBITaxonID'   },
    ],
  },
  {
    label: 'Place',
    properties: [
      { id: 'P625', label: 'coordinates',       field: 'coordinates'      },
      { id: 'P131', label: 'admin. territory',  field: 'adminTerritory'   },
      { id: 'P276', label: 'location',          field: 'location'         },
      { id: 'P36',  label: 'capital',           field: 'capital'          },
    ],
  },
  {
    label: 'Person',
    properties: [
      { id: 'P569', label: 'birth date',  field: 'birthDate'  },
      { id: 'P570', label: 'death date',  field: 'deathDate'  },
      { id: 'P19',  label: 'birth place', field: 'birthPlace' },
      { id: 'P20',  label: 'death place', field: 'deathPlace' },
      { id: 'P106', label: 'occupation',  field: 'occupation' },
      { id: 'P21',  label: 'gender',      field: 'gender'     },
    ],
  },
  {
    label: 'Heritage',
    properties: [
      { id: 'P186',  label: 'material',             field: 'material'            },
      { id: 'P1435', label: 'heritage designation', field: 'heritageDesignation' },
      { id: 'P366',  label: 'has use',              field: 'hasUse'              },
    ],
  },
]

// Flat lookup: property ID → output field name
export const PROPERTY_FIELD_NAMES: Record<string, string> = {}
for (const group of PROPERTY_GROUPS)
  for (const p of group.properties)
    PROPERTY_FIELD_NAMES[p.id] = p.field

// ─── Wikidata API types ───────────────────────────────────────────────────────

interface WDDatavalue { type: string; value: unknown }
interface WDSnak      { snaktype: string; property: string; datavalue?: WDDatavalue }
interface WDStatement { mainsnak: WDSnak; rank: string }
interface WDEntity    {
  id: string
  missing?: string
  labels?: Record<string, { value: string }>
  claims?: Record<string, WDStatement[]>
}

// ─── value parsing ────────────────────────────────────────────────────────────

function parseValue(dv: WDDatavalue): { raw: string; isQID: boolean } | null {
  switch (dv.type) {
    case 'wikibase-entityid': {
      const v = dv.value as { id: string }
      return { raw: v.id, isQID: true }
    }
    case 'string':
      return { raw: dv.value as string, isQID: false }
    case 'monolingualtext': {
      const v = dv.value as { text: string }
      return { raw: v.text, isQID: false }
    }
    case 'quantity': {
      const v = dv.value as { amount: string }
      return { raw: v.amount.replace(/^\+/, ''), isQID: false }
    }
    case 'time': {
      const v = dv.value as { time: string; precision: number }
      const t = v.time.replace(/^\+/, '')
      if (v.precision >= 11) return { raw: t.split('T')[0], isQID: false }
      if (v.precision === 10) return { raw: t.slice(0, 7), isQID: false }
      return { raw: t.slice(0, 4), isQID: false }
    }
    case 'globe-coordinate': {
      const v = dv.value as { latitude: number; longitude: number }
      return { raw: `${v.latitude},${v.longitude}`, isQID: false }
    }
    default:
      return null
  }
}

// ─── API fetch helpers ────────────────────────────────────────────────────────

async function fetchWDEntities(ids: string[]): Promise<Record<string, WDEntity>> {
  if (ids.length === 0) return {}
  const url = new URL(WD_API)
  url.searchParams.set('action',    'wbgetentities')
  url.searchParams.set('ids',       ids.join('|'))
  url.searchParams.set('props',     'claims|labels')
  url.searchParams.set('languages', 'en')
  url.searchParams.set('format',    'json')
  url.searchParams.set('origin',    '*')
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Wikidata API ${res.status}`)
  const data = await res.json() as { entities: Record<string, WDEntity> }
  return data.entities
}

async function resolveLabels(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < qids.length; i += BATCH_SZ) {
    const entities = await fetchWDEntities(qids.slice(i, i + BATCH_SZ))
    for (const [qid, entity] of Object.entries(entities)) {
      const label = entity.labels?.en?.value
      if (label) out.set(qid, label)
    }
  }
  return out
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Fetch selected Wikidata properties for a list of QIDs.
 * Returns Map<QID, { [propId]: "label; label2" }>.
 * wikibase-entityid values are resolved to English labels in a second pass.
 */
export async function fetchWikidataProperties(
  qids: string[],
  properties: string[],
): Promise<Map<string, Record<string, string>>> {
  const result      = new Map<string, Record<string, string>>()
  const refQIDs     = new Set<string>()
  const rawData     = new Map<string, Record<string, { raw: string; isQID: boolean }[]>>()

  for (let i = 0; i < qids.length; i += BATCH_SZ) {
    const entities = await fetchWDEntities(qids.slice(i, i + BATCH_SZ))
    for (const [qid, entity] of Object.entries(entities)) {
      if (entity.missing !== undefined) continue
      const propValues: Record<string, { raw: string; isQID: boolean }[]> = {}
      for (const prop of properties) {
        const vals = (entity.claims?.[prop] ?? [])
          .filter(s => s.rank !== 'deprecated')
          .map(s => s.mainsnak.datavalue ? parseValue(s.mainsnak.datavalue) : null)
          .filter((v): v is { raw: string; isQID: boolean } => v !== null)
        if (vals.length > 0) {
          propValues[prop] = vals
          for (const v of vals) if (v.isQID) refQIDs.add(v.raw)
        }
      }
      rawData.set(qid, propValues)
    }
  }

  const labelMap = await resolveLabels([...refQIDs])

  for (const [qid, propValues] of rawData) {
    const resolved: Record<string, string> = {}
    for (const [prop, vals] of Object.entries(propValues)) {
      resolved[prop] = vals
        .map(v => v.isQID ? (labelMap.get(v.raw) ?? v.raw) : v.raw)
        .join('; ')
    }
    result.set(qid, resolved)
  }

  return result
}
