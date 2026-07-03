import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Handle, Position, NodeProps, useReactFlow, NodeResizer } from '@xyflow/react'
import { useUpstreamRecords } from '../hooks/useUpstreamRecords'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

const HEADER_COLOR    = '#29394a'
const MAX_THUMB_DIM   = 1200
const EXAMPLE_MANIFEST = 'https://iiif.wellcomecollection.org/presentation/b18035723'

export interface ImageViewNodeData {
  mode: 'images' | 'iiif'
  selectedField: string
  manifestUrl: string
  imageDirectUrl: string  // Images mode: overrides field picker when set
  imageCount?: number
  iiifRegions?: IIIFRegion[]
  [key: string]: unknown
}

// ── Region annotator types ────────────────────────────────────────────────────

interface IIIFRegion {
  id: string
  x: number   // normalized 0–1 fraction of canvas width
  y: number   // normalized 0–1 fraction of canvas height
  w: number
  h: number
  label: string
}

interface DrawBox {
  startX: number
  startY: number
  curX: number
  curY: number
}

// ── IIIF types ────────────────────────────────────────────────────────────────

interface IIIFCanvas {
  label: string
  serviceUrl: string | null  // IIIF Image API base URL — used for sized requests
  directUrl: string          // fallback direct image URL
  width?: number
  height?: number
}

interface IIIFMeta {
  title: string
  summary: string
  attribution: string
  rights: string
  date: string
  provider: string
  metadata: Array<{ label: string; value: string }>
}

interface IIIFImageInfo {
  width: number
  height: number
  tileWidth?: number
  profile: string
}

// ── EXIF types ────────────────────────────────────────────────────────────────

interface ExifData {
  make?: string
  model?: string
  dateTime?: string
  exposureTime?: string
  fNumber?: number
  iso?: number
  gps?: { lat: number; lon: number }
}

// ── IIIF helpers ──────────────────────────────────────────────────────────────

function extractLabel(label: unknown, index: number): string {
  if (!label) return `Canvas ${index + 1}`
  if (typeof label === 'string') return label
  if (typeof label === 'object') {
    const obj = label as Record<string, unknown>
    const vals = (obj.en || obj.none || Object.values(obj)[0]) as unknown
    if (Array.isArray(vals)) return String(vals[0])
    return String(vals ?? `Canvas ${index + 1}`)
  }
  return `Canvas ${index + 1}`
}

// Returns IIIF Image API service base URL (strips any existing /full/... suffix)
function extractServiceBase(service: unknown): string | null {
  if (!service) return null
  if (Array.isArray(service)) {
    for (const s of service) { const u = extractServiceBase(s); if (u) return u }
    return null
  }
  if (typeof service === 'string') return service.replace(/\/(info\.json|full\/.+)$/, '')
  if (typeof service === 'object') {
    const s = service as Record<string, unknown>
    const id = String(s.id || s['@id'] || '')
    return id ? id.replace(/\/(info\.json|full\/.+)$/, '') : null
  }
  return null
}

// Tiered size parameter — only fetch full resolution when zoomed far in.
// IIIF Image API spec: /full/!w,h/0/default.jpg constrains to fit within w×h.
function iiifSizeParam(zoom: number): string {
  if (zoom <= 0.75) return '!600,600'
  if (zoom <= 1.5)  return '!1200,1200'
  if (zoom <= 3)    return '!2400,2400'
  return 'max'
}

function iiifSizeLabel(param: string): string {
  if (param === 'max') return 'Full resolution'
  const n = param.replace('!', '').split(',')[0]
  return `≤ ${n} px (constrained)`
}

// Flatten IIIF v2 strings or v3 language maps into a plain string
function flatten(val: unknown): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  if (Array.isArray(val)) return val.map(flatten).filter(Boolean).join('; ')
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>
    const arr = (obj.en || obj.none || Object.values(obj)[0]) as unknown
    return flatten(arr)
  }
  return String(val)
}

function parseIIIFMeta(manifest: Record<string, unknown>, isV3: boolean): IIIFMeta {
  const title       = flatten(manifest.label)
  const summary     = isV3 ? flatten(manifest.summary) : flatten(manifest.description)
  const rights      = isV3 ? String(manifest.rights ?? '') : flatten(manifest.license)
  const attribution = isV3
    ? flatten((manifest.requiredStatement as Record<string, unknown> | undefined)?.value)
    : flatten(manifest.attribution)
  const date     = flatten(manifest.navDate)
  const providers = (manifest.provider as Record<string, unknown>[]) ?? []
  const provider = providers.length ? flatten(providers[0]?.label) : ''
  const metaArr  = (manifest.metadata as Record<string, unknown>[]) ?? []
  const metadata = metaArr
    .map(m => ({ label: flatten(m.label), value: flatten(m.value) }))
    .filter(m => m.label && m.value)
  return { title, summary, attribution, rights, date, provider, metadata }
}

function parseManifest(manifest: Record<string, unknown>, manifestUrl?: string): { canvases: IIIFCanvas[]; meta: IIIFMeta } {
  const ctx    = manifest['@context']
  const ctxArr = Array.isArray(ctx) ? ctx.map(String) : [String(ctx ?? '')]
  const isV3   = ctxArr.some(c => c.includes('presentation/3'))
  const meta   = parseIIIFMeta(manifest, isV3)

  let canvases: IIIFCanvas[]

  if (isV3) {
    const items = (manifest.items as Record<string, unknown>[]) ?? []
    canvases = items.flatMap((canvas, i) => {
      const pages  = (canvas.items as Record<string, unknown>[]) ?? []
      const annots = pages.flatMap(p => (p.items as Record<string, unknown>[]) ?? [])
      return annots.flatMap(ann => {
        const body = ann.body as Record<string, unknown> | undefined
        if (!body) return []
        let serviceUrl: string | null
        let directUrl: string
        if (body.type === 'Choice') {
          const first = ((body.items as Record<string, unknown>[])?.[0]) as Record<string, unknown> ?? {}
          serviceUrl = extractServiceBase(first.service)
          directUrl  = String(first.id || '')
        } else {
          serviceUrl = extractServiceBase(body.service)
          directUrl  = String(body.id || '')
        }
        return [{ label: extractLabel(canvas.label, i), serviceUrl, directUrl, width: canvas.width as number | undefined, height: canvas.height as number | undefined }]
      })
    })
  } else {
    const sequences  = (manifest.sequences as Record<string, unknown>[]) ?? []
    const rawCanvases = ((sequences[0] as Record<string, unknown>)?.canvases as Record<string, unknown>[]) ?? []
    canvases = rawCanvases.flatMap((canvas, i) => {
      const images   = (canvas.images as Record<string, unknown>[]) ?? []
      const resource = images[0]?.resource as Record<string, unknown> | undefined
      if (!resource) return []
      let serviceUrl = extractServiceBase(resource.service)
      let directUrl  = String(resource['@id'] || resource.id || '')
      // Resolve relative resource URLs (e.g. SMG manifests use "/full/max/0/default.jpg")
      if (directUrl.startsWith('/')) {
        const canvasId = String(canvas['@id'] || '')
        const base = canvasId
          ? canvasId.replace(/\/canvas\/\d+$/, '')
          : String(manifest['@id'] || manifestUrl || '').replace(/\/manifest$/, '')
        if (base) {
          if (!serviceUrl) serviceUrl = base
          directUrl = base + directUrl
        }
      }
      return [{ label: String(canvas.label || `Canvas ${i + 1}`), serviceUrl, directUrl, width: canvas.width as number | undefined, height: canvas.height as number | undefined }]
    })
  }

  return { canvases, meta }
}

async function fetchManifest(url: string): Promise<Record<string, unknown>> {
  const hdrs = { Accept: 'application/json, application/ld+json' }
  try {
    const r = await fetch(url, { headers: hdrs, signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json() as Promise<Record<string, unknown>>
  } catch {
    const r = await fetch(`/url-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return JSON.parse(await r.text()) as Record<string, unknown>
  }
}

async function fetchImageInfo(serviceUrl: string): Promise<IIIFImageInfo | null> {
  try {
    const r = await fetch(`${serviceUrl}/info.json`, {
      headers: { Accept: 'application/json, application/ld+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return null
    const info = await r.json() as Record<string, unknown>
    const tiles    = (info.tiles as Record<string, unknown>[]) ?? []
    const tileWidth = tiles[0]?.width as number | undefined
    const profileArr = Array.isArray(info.profile) ? info.profile : [info.profile]
    const profileStr = String(profileArr[0] ?? '').split('/').pop() ?? ''
    return { width: Number(info.width ?? 0), height: Number(info.height ?? 0), tileWidth, profile: profileStr }
  } catch {
    return null
  }
}

// ── Region capture helpers ────────────────────────────────────────────────────

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

async function urlToBase64(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return blobToDataUrl(await r.blob())
  } catch {
    const r = await fetch(`/url-proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return blobToDataUrl(await r.blob())
  }
}

function normalizeBox(box: DrawBox): { x: number; y: number; w: number; h: number } {
  const x = Math.min(box.startX, box.curX)
  const y = Math.min(box.startY, box.curY)
  return { x, y, w: Math.abs(box.curX - box.startX), h: Math.abs(box.curY - box.startY) }
}

// ── EXIF parser ───────────────────────────────────────────────────────────────
// Minimal inline parser — no library dependency. Reads only the first 64 KB of
// the JPEG (EXIF always sits in the APP1 segment near the start of the file).

function parseJpegExif(dataUrl: string): ExifData | null {
  if (!dataUrl.startsWith('data:image/jpeg') && !dataUrl.startsWith('data:image/jpg')) return null
  try {
    const b64 = dataUrl.split(',')[1]
    // Decode only first ~64 KB (87380 base64 chars → 65535 bytes) — EXIF is always here
    const raw = Uint8Array.from(atob(b64.slice(0, 87380)), c => c.charCodeAt(0))
    let pos = 2
    while (pos < raw.length - 4) {
      if (raw[pos] !== 0xFF) break
      const marker = raw[pos + 1]
      const segLen = (raw[pos + 2] << 8) | raw[pos + 3]
      // APP1 with "Exif\0\0" identifier
      if (marker === 0xE1 &&
          raw[pos+4] === 0x45 && raw[pos+5] === 0x78 &&
          raw[pos+6] === 0x69 && raw[pos+7] === 0x66 &&
          raw[pos+8] === 0x00 && raw[pos+9] === 0x00) {
        return parseTiff(raw, pos + 10)
      }
      if (marker === 0xDA) break  // start of scan data
      pos += 2 + segLen
    }
  } catch { /* */ }
  return null
}

function parseTiff(raw: Uint8Array, base: number): ExifData {
  const le  = raw[base] === 0x49  // 'II' = little-endian
  const u16 = (o: number) => le ? raw[base+o] | raw[base+o+1]<<8 : raw[base+o]<<8 | raw[base+o+1]
  const u32 = (o: number) => (le
    ? raw[base+o] | raw[base+o+1]<<8 | raw[base+o+2]<<16 | raw[base+o+3]<<24
    : raw[base+o]<<24 | raw[base+o+1]<<16 | raw[base+o+2]<<8 | raw[base+o+3]) >>> 0
  const str = (o: number, n: number) => { let s = ''; for (let i = 0; i < n && raw[base+o+i]; i++) s += String.fromCharCode(raw[base+o+i]); return s.trim() }
  const rat = (o: number) => { const d = u32(o+4); return d ? u32(o)/d : 0 }

  // TYPE_SIZE indexed by TIFF type tag (1=BYTE 2=ASCII 3=SHORT 4=LONG 5=RATIONAL …)
  const TYPE_SZ = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8]

  function readIFD(ifdOff: number, want: Set<number>): Map<number, unknown> {
    const m = new Map<number, unknown>()
    const n = u16(ifdOff)
    for (let i = 0; i < n && i < 512; i++) {
      const e    = ifdOff + 2 + i * 12
      const tag  = u16(e)
      if (!want.has(tag)) continue
      const type = u16(e + 2)
      const cnt  = u32(e + 4)
      const sz   = (TYPE_SZ[type] ?? 1) * cnt
      const off  = sz <= 4 ? e + 8 : u32(e + 8)  // in-place or TIFF-relative offset
      if (type === 2) {
        m.set(tag, str(off, cnt))
      } else if ((type === 3 || type === 4) && cnt === 1) {
        m.set(tag, type === 3 ? u16(off) : u32(off))
      } else if (type === 5 && cnt === 1) {
        m.set(tag, rat(off))
      } else if (type === 5 && cnt === 3) {
        // GPS DMS: three rationals
        m.set(tag, [rat(off), rat(off+8), rat(off+16)])
      }
    }
    return m
  }

  const ifd0 = readIFD(u32(4), new Set([0x010F, 0x0110, 0x0132, 0x8769, 0x8825]))
  const result: ExifData = {}

  if (ifd0.has(0x010F)) result.make     = String(ifd0.get(0x010F))
  if (ifd0.has(0x0110)) result.model    = String(ifd0.get(0x0110))
  if (ifd0.has(0x0132)) result.dateTime = String(ifd0.get(0x0132))

  if (ifd0.has(0x8769)) {
    const exif = readIFD(Number(ifd0.get(0x8769)), new Set([0x9003, 0x829A, 0x829D, 0x8827]))
    if (exif.has(0x9003)) result.dateTime = String(exif.get(0x9003))
    if (exif.has(0x829A)) {
      const et = Number(exif.get(0x829A))
      result.exposureTime = et > 0 && et < 1 ? `1/${Math.round(1/et)}s` : `${et}s`
    }
    if (exif.has(0x829D)) result.fNumber = +Number(exif.get(0x829D)).toFixed(1)
    if (exif.has(0x8827)) result.iso = Number(exif.get(0x8827))
  }

  if (ifd0.has(0x8825)) {
    const gps    = readIFD(Number(ifd0.get(0x8825)), new Set([0x0001, 0x0002, 0x0003, 0x0004]))
    const latRef = String(gps.get(0x0001) ?? 'N')
    const lonRef = String(gps.get(0x0003) ?? 'E')
    const latDMS = gps.get(0x0002) as number[] | undefined
    const lonDMS = gps.get(0x0004) as number[] | undefined
    if (latDMS && lonDMS) {
      const dms = ([d, m, s]: number[]) => d + m/60 + s/3600
      result.gps = { lat: dms(latDMS) * (latRef === 'S' ? -1 : 1), lon: dms(lonDMS) * (lonRef === 'W' ? -1 : 1) }
    }
  }
  return result
}

// ── Upstream IIIF manifest scanner ───────────────────────────────────────────
// Inspects upstream records for any IIIF manifest URL so the node can offer
// a picker instead of requiring the user to copy-paste URLs manually.

interface ManifestEntry { url: string; label: string }

function extractManifestEntries(records: Record<string, unknown>[]): ManifestEntry[] {
  const seen    = new Set<string>()
  const results: ManifestEntry[] = []

  for (const rec of records) {
    let url = ''

    // 1. Named namespace — bodleian.manifest, smg.manifest, vam.manifest, and future services
    const ns = (rec.bodleian ?? rec.smg ?? rec.vam ?? rec.iiif) as Record<string, unknown> | undefined
    if (typeof ns?.manifest === 'string' && ns.manifest) url = ns.manifest

    // 2. Top-level field names
    if (!url) {
      for (const key of ['manifest', 'manifestUrl', 'iiifManifest', 'iiif']) {
        const v = rec[key]
        if (typeof v === 'string' && v) { url = v; break }
      }
    }

    // 3. Any string field whose value looks like a IIIF manifest URL
    if (!url) {
      for (const val of Object.values(rec)) {
        if (typeof val === 'string' && val.includes('/iiif/manifest/')) { url = val; break }
      }
    }

    if (url && !seen.has(url)) {
      seen.add(url)
      const label = String(
        rec.title ||
        (ns as Record<string, unknown> | undefined)?.shelfmark ||
        rec._id ||
        url.split('/').filter(Boolean).at(-1),
      )
      results.push({ url, label })
    }
  }

  return results.slice(0, 100)
}

// ── Downsampling hook ─────────────────────────────────────────────────────────

function useDownsampledImage(src: string | null): {
  thumb: string | null
  thumbLoading: boolean
  origWidth: number | null
  origHeight: number | null
} {
  const [thumb, setThumb]           = useState<string | null>(null)
  const [thumbLoading, setLoading]  = useState(false)
  const [origWidth, setW]           = useState<number | null>(null)
  const [origHeight, setH]          = useState<number | null>(null)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!src) { setThumb(null); setW(null); setH(null); return }
    if (!src.startsWith('data:image/')) { setThumb(src); setW(null); setH(null); return }

    cancelled.current = false
    setLoading(true); setThumb(null); setW(null); setH(null)

    const img = new Image()
    img.onload = () => {
      if (cancelled.current) return
      setW(img.width); setH(img.height)
      const scale = Math.min(1, MAX_THUMB_DIM / Math.max(img.width, img.height, 1))
      if (scale >= 1) {
        setThumb(src)
      } else {
        const cv = document.createElement('canvas')
        cv.width  = Math.round(img.width  * scale)
        cv.height = Math.round(img.height * scale)
        cv.getContext('2d')?.drawImage(img, 0, 0, cv.width, cv.height)
        setThumb(cv.toDataURL('image/jpeg', 0.87))
      }
      setLoading(false)
    }
    img.onerror = () => { if (!cancelled.current) { setThumb(src); setLoading(false) } }
    img.src = src
    return () => { cancelled.current = true }
  }, [src])

  return { thumb, thumbLoading, origWidth, origHeight }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImageViewNode({ id, data, selected }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const { records, connected } = useUpstreamRecords(id)
  const d = data as ImageViewNodeData

  const mode = (d.mode as 'images' | 'iiif') || 'images'
  const [recordIndex,  setRecordIndex]  = useState(0)
  const [canvasIndex,  setCanvasIndex]  = useState(0)
  const [zoom,         setZoom]         = useState(1)
  const [showMeta,     setShowMeta]     = useState(false)
  const [canvases,     setCanvases]     = useState<IIIFCanvas[] | null>(null)
  const [manifestMeta, setManifestMeta] = useState<IIIFMeta | null>(null)
  const [manifestLoading, setManLoading] = useState(false)
  const [manifestError,   setManError]   = useState('')
  const [localUrl,     setLocalUrl]     = useState(d.manifestUrl || '')
  const [imageInfo,    setImageInfo]    = useState<IIIFImageInfo | null>(null)
  const [iiifRegions,  setIiifRegions]  = useState<IIIFRegion[]>(() => (d.iiifRegions as IIIFRegion[] | undefined) ?? [])
  const [drawMode,     setDrawMode]     = useState(false)
  const [drawBox,      setDrawBox]      = useState<DrawBox | null>(null)
  const [capturing,    setCapturing]    = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const availableFields = useMemo<string[]>(() => {
    if (!records?.length) return []
    const keys = new Set<string>()
    const IMAGE_KEYS = /thumb|image|url|src|href|photo|picture|preview|media|icon/i

    // One representative record per _source ensures namespace fields from every
    // connected data service appear in the picker, regardless of dataset sizes.
    const seen = new Set<string>()
    const representatives: typeof records = []
    for (const r of records) {
      const src = (r as Record<string, unknown>)._source as string | undefined ?? ''
      if (!seen.has(src)) { seen.add(src); representatives.push(r) }
    }

    for (const r of representatives) {
      const rec = r as Record<string, unknown>
      for (const [k, v] of Object.entries(rec)) {
        if (k.startsWith('_')) continue
        keys.add(k)
        // Also surface any field whose value is a data URL (e.g. 'content' from FileRecord)
        if (typeof v === 'string' && v.startsWith('data:image/')) {
          keys.add(k)
        }
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
          for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
            if (IMAGE_KEYS.test(nk) && (typeof nv === 'string' || nv == null)) {
              keys.add(`${k}.${nk}`)
            }
          }
        }
      }
    }
    return [...keys].sort()
  }, [records])

  const upstreamManifests = useMemo<ManifestEntry[]>(() => {
    if (!records?.length) return []
    return extractManifestEntries(records as Record<string, unknown>[])
  }, [records])

  const selectedField    = (d.selectedField as string | undefined) ?? ''
  const imageDirectUrl   = String(d.imageDirectUrl || '')

  // Auto-select 'content' when connected records are local images (contentType === 'image')
  // and no field has been chosen yet. Handles LocalFileSourceNode, LocalFolderSourceNode
  // image handle, and PDF page image records.
  useEffect(() => {
    if (mode !== 'images' || selectedField || imageDirectUrl) return
    if (!records?.length) return
    const hasImageRecords = records.some(
      r => (r as Record<string, unknown>).contentType === 'image'
    )
    if (hasImageRecords) updateNodeData(id, { selectedField: 'content' })
  }, [records, selectedField, imageDirectUrl, mode, id, updateNodeData])
  const safeRecordIndex  = records?.length ? Math.min(recordIndex, records.length - 1) : 0
  const currentRecord    = (records?.[safeRecordIndex] ?? {}) as Record<string, unknown>

  // Resolve dot-notation field paths (e.g. europeana.thumbnail) from a record
  function resolveFieldPath(rec: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.')
    let val: unknown = rec
    for (const part of parts) {
      if (val == null || typeof val !== 'object') return undefined
      val = (val as Record<string, unknown>)[part]
    }
    return val
  }

  // Direct URL overrides field picker; field picker supports dot-notation paths
  const rawSrc           = mode === 'images'
    ? (imageDirectUrl || (() => {
        const v = resolveFieldPath(currentRecord, selectedField)
        return typeof v === 'string' && v ? v : null
      })())
    : null

  const exifData    = useMemo(() => rawSrc ? parseJpegExif(rawSrc) : null, [rawSrc])
  const localSizeKb = rawSrc?.startsWith('data:image/')
    ? Math.round(rawSrc.length * 3 / 4 / 1024) : null

  const { thumb, thumbLoading, origWidth, origHeight } = useDownsampledImage(rawSrc)

  const saveRegions = useCallback((regions: IIIFRegion[]) => {
    setIiifRegions(regions)
    updateNodeData(id, { iiifRegions: regions })
  }, [id, updateNodeData])

  const loadManifest = useCallback(async (url: string) => {
    if (!url.trim()) return
    setManLoading(true); setManError(''); setDrawMode(false); setDrawBox(null)
    try {
      const raw = await fetchManifest(url.trim())
      const { canvases: c, meta } = parseManifest(raw, url.trim())
      if (!c.length) throw new Error('No images found in manifest')
      setCanvases(c); setManifestMeta(meta); setCanvasIndex(0); setImageInfo(null)
    } catch (err) {
      setManError(err instanceof Error ? err.message : 'Failed to load manifest')
      setCanvases(null); setManifestMeta(null)
    } finally {
      setManLoading(false)
    }
  }, [])

  const savedUrl = d.manifestUrl || ''
  useEffect(() => {
    if (mode === 'iiif' && savedUrl) { setLocalUrl(savedUrl); loadManifest(savedUrl) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedUrl, mode])

  const safeCanvasIndex = canvases ? Math.min(canvasIndex, canvases.length - 1) : 0
  const currentCanvas   = canvases?.[safeCanvasIndex]

  // Fetch info.json whenever the canvas service URL changes
  useEffect(() => {
    if (!currentCanvas?.serviceUrl) { setImageInfo(null); return }
    fetchImageInfo(currentCanvas.serviceUrl).then(setImageInfo)
  }, [currentCanvas?.serviceUrl])

  const captureAndSend = useCallback(async () => {
    if (!currentCanvas) return
    setCapturing(true)
    clearNodeResults(id)
    try {
      const toCapture: IIIFRegion[] = iiifRegions.length > 0
        ? iiifRegions
        : [{ id: 'full', x: 0, y: 0, w: 1, h: 1, label: currentCanvas.label || 'Full canvas' }]
      const recs: Record<string, unknown>[] = []
      for (let i = 0; i < toCapture.length; i++) {
        const region = toCapture[i]
        const regionUrl = currentCanvas.serviceUrl
          ? `${currentCanvas.serviceUrl}/pct:${(region.x*100).toFixed(1)},${(region.y*100).toFixed(1)},${(region.w*100).toFixed(1)},${(region.h*100).toFixed(1)}/!1024,1024/0/default.jpg`
          : currentCanvas.directUrl
        const dataUrl = await urlToBase64(regionUrl)
        recs.push({
          content:      dataUrl,
          contentType:  'image',
          mimeType:     'image/jpeg',
          title:        region.label || `Region ${i + 1}`,
          regionIndex:  i,
          regionBounds: { x: region.x, y: region.y, w: region.w, h: region.h },
          canvasLabel:  currentCanvas.label,
          ...(manifestMeta ? { manifestTitle: manifestMeta.title, manifestProvider: manifestMeta.provider } : {}),
          _source: 'imageView',
          _id:     `${id}_region_${i}`,
        })
      }
      const version = setNodeResults(id, recs)
      updateNodeData(id, { resultsVersion: version, imageCount: recs.length })
    } catch (err) {
      console.error('IIIF capture failed:', err)
      updateNodeData(id, { imageCount: 0 })
    } finally {
      setCapturing(false)
    }
  }, [currentCanvas, iiifRegions, id, manifestMeta, updateNodeData])

  const getSvgCoords = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left)  / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    }
  }, [])

  const onSvgPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = getSvgCoords(e)
    setDrawBox({ startX: x, startY: y, curX: x, curY: y })
  }, [drawMode, getSvgCoords])

  const onSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode || !drawBox) return
    e.stopPropagation()
    const { x, y } = getSvgCoords(e)
    setDrawBox(prev => prev ? { ...prev, curX: x, curY: y } : null)
  }, [drawMode, drawBox, getSvgCoords])

  const onSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawMode) return
    e.stopPropagation()
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (drawBox) {
      const { x, y } = getSvgCoords(e)
      const nb = normalizeBox({ ...drawBox, curX: x, curY: y })
      if (nb.w > 0.02 && nb.h > 0.02) {
        saveRegions([...iiifRegions, { id: `r${Date.now()}`, ...nb, label: `Region ${iiifRegions.length + 1}` }])
      }
    }
    setDrawBox(null)
  }, [drawMode, drawBox, getSvgCoords, iiifRegions, saveRegions])

  // Build display URL: for IIIF Image API services use a zoom-tiered size param
  // rather than /full/max — this is the key efficiency gain.
  const displaySrc = mode === 'iiif'
    ? (currentCanvas?.serviceUrl
        ? `${currentCanvas.serviceUrl}/full/${iiifSizeParam(zoom)}/0/default.jpg`
        : (currentCanvas?.directUrl ?? null))
    : thumb

  const displayLabel = mode === 'iiif'
    ? (currentCanvas?.label ?? '')
    : String(currentRecord.title || currentRecord.filename || currentRecord.id || `Record ${safeRecordIndex + 1}`)

  // ── Write current image to results store ─────────────────────────────────────
  // Images mode: reacts to rawSrc changing (field selection, record navigation)
  useEffect(() => {
    if (mode !== 'images') return
    if (!rawSrc) {
      clearNodeResults(id)
      updateNodeData(id, { resultsVersion: 0, imageCount: 0 })
      return
    }
    const mimeType = /^data:(image\/[^;]+)/.exec(rawSrc)?.[1] ?? 'image/jpeg'
    const record: Record<string, unknown> = {
      ...currentRecord,
      content:     rawSrc,
      contentType: 'image',
      mimeType,
      title:       displayLabel,
      _source:     'imageView',
    }
    const version = setNodeResults(id, [record])
    updateNodeData(id, { resultsVersion: version, imageCount: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSrc, mode, id])

  // IIIF mode: clear results on canvas navigation — capture is now explicit via Capture button
  useEffect(() => {
    if (mode !== 'iiif') return
    clearNodeResults(id)
    updateNodeData(id, { resultsVersion: 0, imageCount: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCanvas, mode, id])

  function setMode(m: 'images' | 'iiif') { updateNodeData(id, { mode: m }); setZoom(1) }

  const prevItem = () => mode === 'images' ? setRecordIndex(i => Math.max(0, i-1)) : setCanvasIndex(i => Math.max(0, i-1))
  const nextItem = () => mode === 'images' ? setRecordIndex(i => Math.min((records?.length ?? 1)-1, i+1)) : setCanvasIndex(i => Math.min((canvases?.length ?? 1)-1, i+1))
  const isFirst = mode === 'images' ? safeRecordIndex === 0 : safeCanvasIndex === 0
  const isLast  = mode === 'images' ? safeRecordIndex === (records?.length ?? 1)-1 : safeCanvasIndex === (canvases?.length ?? 1)-1
  const total   = mode === 'images' ? (records?.length ?? 0) : (canvases?.length ?? 0)
  const current = mode === 'images' ? safeRecordIndex + 1 : safeCanvasIndex + 1
  // Suppress record navigation when a direct image URL is active — not meaningful
  const showNav = total > 0 && !(mode === 'images' && imageDirectUrl)

  return (
    <>
      <NodeResizer
        minWidth={280} minHeight={260} isVisible={selected}
        lineStyle={{ borderColor: HEADER_COLOR }}
        handleStyle={{ background: HEADER_COLOR, borderColor: '#fff', width: 8, height: 8 }}
      />
      <div style={s.card}>
        <Handle type="target" position={Position.Left}  id="data"    style={s.handle} />
        <Handle type="source" position={Position.Right} id="results" style={s.outputHandle} />

        {/* Header */}
        <div style={s.header}>
          <span style={s.headerTitle}>Image View</span>
          <div style={s.modeGroup}>
            <button style={{ ...s.modeBtn, ...(mode==='images' ? s.modeBtnActive : {}) }} onClick={() => setMode('images')} className="nodrag">Images</button>
            <button style={{ ...s.modeBtn, ...(mode==='iiif'   ? s.modeBtnActive : {}) }} onClick={() => setMode('iiif')}   className="nodrag">IIIF</button>
          </div>
        </div>

        {/* Controls */}
        {mode === 'images' ? (
          <div style={s.toolbarImages}>
            {/* Row 1: field picker — datalist combobox allows freetyping dot-notation paths */}
            <div style={s.toolbarRow}>
              <span style={s.srcLabel}>Field</span>
              {availableFields.length > 0 ? (
                <>
                  <input
                    list={`imgfields-${id}`}
                    style={s.fieldSelect}
                    value={selectedField}
                    onChange={e => { updateNodeData(id, { selectedField: e.target.value }); setRecordIndex(0) }}
                    placeholder="Start typing field name to select…"
                    className="nodrag"
                    spellCheck={false}
                  />
                  <datalist id={`imgfields-${id}`}>
                    {availableFields.map(f => <option key={f} value={f} />)}
                  </datalist>
                </>
              ) : (
                <span style={s.hint}>{connected ? 'Run upstream node first' : 'Connect a node'}</span>
              )}
            </div>
            {/* Row 2: direct public URL (overrides field when set) */}
            <div style={s.toolbarRow}>
              <span style={s.srcLabel}>URL</span>
              <input style={{ ...s.urlInput, ...(imageDirectUrl ? { borderColor: HEADER_COLOR } : {}) }}
                value={imageDirectUrl}
                onChange={e => updateNodeData(id, { imageDirectUrl: e.target.value })}
                placeholder="or paste public image URL…"
                className="nodrag" spellCheck={false} />
              {imageDirectUrl && (
                <button style={s.clearBtn} onClick={() => updateNodeData(id, { imageDirectUrl: '' })}
                  className="nodrag" title="Clear URL">×</button>
              )}
            </div>
          </div>
        ) : (
          <div style={s.toolbarImages}>
            {/* Upstream picker — only shown when upstream records have IIIF manifests */}
            {upstreamManifests.length > 0 && (
              <div style={s.toolbarRow}>
                <span style={s.srcLabel}>From</span>
                <select
                  style={{ ...s.fieldSelect, fontFamily: 'inherit' }}
                  value={upstreamManifests.some(m => m.url === localUrl) ? localUrl : ''}
                  onChange={e => {
                    const url = e.target.value
                    if (!url) return
                    setLocalUrl(url)
                    updateNodeData(id, { manifestUrl: url })
                    loadManifest(url)
                  }}
                  className="nodrag"
                >
                  <option value="">— select from upstream ({upstreamManifests.length}) —</option>
                  {upstreamManifests.map((m, i) => (
                    <option key={i} value={m.url}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Manual URL input */}
            <div style={s.toolbarRow}>
              <input style={s.urlInput} value={localUrl}
                onChange={e => setLocalUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (updateNodeData(id, { manifestUrl: localUrl }), loadManifest(localUrl))}
                placeholder="IIIF manifest URL…" className="nodrag" spellCheck={false} />
              <button style={s.loadBtn}
                onClick={() => { updateNodeData(id, { manifestUrl: localUrl }); loadManifest(localUrl) }}
                disabled={manifestLoading || !localUrl.trim()} className="nodrag">
                {manifestLoading ? '…' : 'Load'}
              </button>
            </div>
            {/* Example — demoted to an optional button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                style={s.exampleBtn}
                onClick={() => {
                  setLocalUrl(EXAMPLE_MANIFEST)
                  updateNodeData(id, { manifestUrl: EXAMPLE_MANIFEST })
                  loadManifest(EXAMPLE_MANIFEST)
                }}
                className="nodrag"
                title="Wellcome Collection — Edward Topsell, The History of Four-Footed Beasts (1658)"
              >
                Load example
              </button>
            </div>
          </div>
        )}

        {/* Region annotator toolbar — IIIF only */}
        {mode === 'iiif' && canvases && (
          <div style={s.regionBar} className="nodrag">
            <button
              style={{ ...s.regionBtn, ...(drawMode ? { background: '#f97316', color: '#fff', borderColor: '#f97316' } : {}) }}
              onClick={() => { setDrawMode(v => !v); setDrawBox(null) }}
            >
              {drawMode ? '✎ Drawing…' : '+ Region'}
            </button>
            {iiifRegions.length > 0 && (
              <span style={s.regionCount}>{iiifRegions.length} region{iiifRegions.length !== 1 ? 's' : ''}</span>
            )}
            <div style={{ flex: 1 }} />
            {iiifRegions.length > 0 && (
              <button style={{ ...s.regionBtn, color: '#9ca3af', fontSize: 9 }} onClick={() => saveRegions([])}>
                Clear
              </button>
            )}
            <button
              style={{ ...s.regionBtn, background: HEADER_COLOR, color: '#fff', borderColor: HEADER_COLOR,
                       opacity: (capturing || !currentCanvas) ? 0.6 : 1 }}
              onClick={captureAndSend}
              disabled={capturing || !currentCanvas}
            >
              {capturing ? 'Capturing…' : iiifRegions.length > 0 ? `Capture ${iiifRegions.length}` : 'Capture'}
            </button>
          </div>
        )}

        {/* Navigation */}
        {showNav && (
          <div style={s.navBar}>
            <button style={s.navBtn} onClick={prevItem} disabled={isFirst} className="nodrag">‹</button>
            <span style={s.navLabel} title={displayLabel}>{displayLabel}</span>
            <span style={s.navCount}>{current}/{total}</span>
            <button style={s.navBtn} onClick={nextItem} disabled={isLast} className="nodrag">›</button>
          </div>
        )}

        {/* Image area */}
        <div style={s.imageWrap} className="nodrag nowheel">
          {manifestError ? (
            <div style={s.errorMsg}>{manifestError}</div>
          ) : (thumbLoading || (mode === 'iiif' && manifestLoading)) ? (
            <div style={s.placeholder}>Loading…</div>
          ) : !displaySrc ? (
            <div style={s.placeholder}>
              {mode === 'images'
                ? (connected ? 'Select a field containing an image' : 'Connect a node to the input handle')
                : (upstreamManifests.length > 0
                    ? 'Select a record above, or enter a manifest URL'
                    : 'Enter a IIIF manifest URL, or click Load example')}
            </div>
          ) : mode === 'iiif' ? (
            <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0, minWidth: 0 }}>
              <img src={displaySrc} alt={displayLabel}
                style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto', display: 'block' }} />
              <svg
                ref={svgRef}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                className="nodrag nowheel"
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  cursor: drawMode ? 'crosshair' : 'default',
                  pointerEvents: (drawMode || iiifRegions.length > 0) ? 'auto' : 'none',
                }}
                onPointerDown={onSvgPointerDown}
                onPointerMove={onSvgPointerMove}
                onPointerUp={onSvgPointerUp}
              >
                {iiifRegions.map((r, idx) => (
                  <g key={r.id}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h}
                      fill="rgba(59,130,246,0.15)" stroke="#3b82f6" strokeWidth={0.004} />
                    <text x={r.x + 0.01} y={r.y + 0.045} fontSize="0.04" fill="#1d4ed8"
                      style={{ pointerEvents: 'none', fontFamily: 'sans-serif', fontWeight: 700 }}>
                      {r.label}
                    </text>
                    <g style={{ cursor: 'pointer' }}
                      onClick={e => { e.stopPropagation(); saveRegions(iiifRegions.filter((_, j) => j !== idx)) }}>
                      <rect x={r.x + r.w - 0.03} y={r.y} width={0.03} height={0.03}
                        fill="#ef4444" rx={0.005} />
                      <text x={r.x + r.w - 0.015} y={r.y + 0.022} textAnchor="middle"
                        dominantBaseline="middle" fontSize="0.025" fill="white"
                        style={{ pointerEvents: 'none', fontFamily: 'sans-serif' }}>×</text>
                    </g>
                  </g>
                ))}
                {drawBox && (() => {
                  const nb = normalizeBox(drawBox)
                  return (
                    <rect x={nb.x} y={nb.y} width={nb.w} height={nb.h}
                      fill="rgba(249,115,22,0.2)" stroke="#f97316"
                      strokeWidth={0.005} strokeDasharray="0.02 0.01" />
                  )
                })()}
              </svg>
            </div>
          ) : (
            <img src={displaySrc} alt={displayLabel}
              style={{ width: `${zoom * 100}%`, maxWidth: 'none', height: 'auto', display: 'block' }} />
          )}
        </div>

        {/* Zoom bar */}
        <div style={s.zoomBar} className="nodrag">
          <button style={s.zoomBtn} onClick={() => setZoom(z => Math.max(0.25, +(z-0.25).toFixed(2)))}>−</button>
          <span style={s.zoomLabel}>{Math.round(zoom*100)}%</span>
          <button style={s.zoomBtn} onClick={() => setZoom(z => Math.min(4, +(z+0.25).toFixed(2)))}>+</button>
          <button style={s.zoomResetBtn} onClick={() => setZoom(1)}>Reset</button>
          <div style={{ flex: 1 }} />
          <button
            style={{ ...s.zoomResetBtn, background: showMeta ? HEADER_COLOR : 'transparent', color: showMeta ? '#fff' : '#6b7280', borderColor: showMeta ? HEADER_COLOR : '#d1d5db' }}
            onClick={() => setShowMeta(v => !v)}
          >ℹ Info</button>
        </div>

        {/* Metadata panel */}
        {showMeta && (
          <div style={s.metaPanel} className="nodrag nowheel">
            {mode === 'iiif' && (
              <>
                {manifestMeta?.title       && <MRow k="Title"       v={manifestMeta.title} />}
                {manifestMeta?.summary     && <MRow k="Summary"     v={manifestMeta.summary} />}
                {manifestMeta?.date        && <MRow k="Date"        v={manifestMeta.date} />}
                {manifestMeta?.attribution && <MRow k="Attribution" v={manifestMeta.attribution} />}
                {manifestMeta?.provider    && <MRow k="Provider"    v={manifestMeta.provider} />}
                {manifestMeta?.rights      && <MRow k="Rights"      v={manifestMeta.rights} />}
                {manifestMeta?.metadata.map((m, i) => <MRow key={i} k={m.label} v={m.value} />)}
                {(currentCanvas?.width ?? imageInfo?.width) != null && (
                  <MRow k="Canvas" v={`${currentCanvas?.width ?? imageInfo?.width} × ${currentCanvas?.height ?? imageInfo?.height} px`} />
                )}
                {imageInfo?.width ? <>
                  <MRow k="Full image" v={`${imageInfo.width.toLocaleString()} × ${imageInfo.height.toLocaleString()} px`} />
                  {imageInfo.tileWidth && <MRow k="Tile size" v={`${imageInfo.tileWidth} px`} />}
                  {imageInfo.profile && <MRow k="Profile" v={imageInfo.profile} />}
                </> : null}
                {currentCanvas?.serviceUrl && (
                  <MRow k="Requesting" v={iiifSizeLabel(iiifSizeParam(zoom))} />
                )}
                {!currentCanvas?.serviceUrl && currentCanvas?.directUrl && (
                  <MRow k="Source" v="Direct URL (no IIIF Image API service)" />
                )}
              </>
            )}
            {mode === 'images' && (
              <>
                {imageDirectUrl && <MRow k="Source" v={imageDirectUrl} />}
                {origWidth  && <MRow k="Dimensions" v={`${origWidth} × ${origHeight} px`} />}
                {localSizeKb && <MRow k="Est. size"  v={`≈ ${localSizeKb.toLocaleString()} KB`} />}
                {exifData?.make        && <MRow k="Camera"   v={[exifData.make, exifData.model].filter(Boolean).join(' ')} />}
                {exifData?.dateTime    && <MRow k="Taken"    v={exifData.dateTime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')} />}
                {exifData?.exposureTime && <MRow k="Exposure" v={exifData.exposureTime} />}
                {exifData?.fNumber != null && <MRow k="Aperture" v={`f/${exifData.fNumber}`} />}
                {exifData?.iso         && <MRow k="ISO"      v={String(exifData.iso)} />}
                {exifData?.gps         && <MRow k="GPS"      v={`${exifData.gps.lat.toFixed(5)}, ${exifData.gps.lon.toFixed(5)}`} />}
                {!exifData && rawSrc?.startsWith('data:image/jpeg') && (
                  <div style={s.metaHint}>No EXIF data found in this image</div>
                )}
                {rawSrc && !rawSrc.startsWith('data:image/') && (
                  <div style={s.metaHint}>EXIF not available for remote images</div>
                )}
                {!rawSrc && <div style={s.metaHint}>No image selected</div>}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ── Small presentational component ───────────────────────────────────────────

function MRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 6, padding: '2px 10px', borderBottom: '1px solid #f8fafc', minHeight: 20 }}>
      <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, flexShrink: 0, width: 72, paddingTop: 1 }}>{k}</span>
      <span style={{ fontSize: 10, color: '#111827', flex: 1, wordBreak: 'break-all', paddingTop: 1 }} title={v}>{v}</span>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  card: {
    width: '100%', height: '100%', minWidth: 280, minHeight: 260,
    background: '#fff', border: '1.5px solid #d1d5db', borderRadius: 8,
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex',
    flexDirection: 'column' as const, overflow: 'hidden',
  },
  header: {
    background: HEADER_COLOR, borderRadius: '6px 6px 0 0',
    padding: '0 10px', height: 32, display: 'flex',
    alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
  },
  headerTitle: { color: '#fff', fontWeight: 700, fontSize: 12 },
  modeGroup:   { display: 'flex', gap: 2 },
  modeBtn: {
    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#94a3b8',
    borderRadius: 3, padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer',
  },
  modeBtnActive: { background: 'rgba(255,255,255,0.25)', color: '#fff' },
  exampleBtn: {
    background: 'transparent', color: '#9ca3af', border: '1px solid #e5e7eb',
    borderRadius: 3, padding: '1px 8px', fontSize: 10, cursor: 'pointer',
    fontStyle: 'italic' as const,
  },
  toolbarImages: {
    display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '6px 10px',
    borderBottom: '1px solid #f1f5f9', flexShrink: 0,
  },
  toolbarRow: { display: 'flex', alignItems: 'center', gap: 6 },
  srcLabel: { fontSize: 10, color: '#9ca3af', fontWeight: 600, width: 28, flexShrink: 0 },
  clearBtn: {
    background: 'transparent', color: '#9ca3af', border: 'none', borderRadius: 3,
    width: 18, height: 18, fontSize: 14, cursor: 'pointer', padding: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    lineHeight: 1, fontWeight: 700,
  },
  fieldSelect: {
    flex: 1, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', height: 24, fontFamily: 'monospace',
  },
  urlInput: {
    flex: 1, fontSize: 11, padding: '2px 6px', border: '1px solid #d1d5db',
    borderRadius: 4, outline: 'none', height: 24, fontFamily: 'monospace', minWidth: 0,
  },
  loadBtn: {
    background: HEADER_COLOR, color: '#fff', border: 'none', borderRadius: 4,
    padding: '2px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0, height: 24,
  },
  hint: { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' as const },
  navBar: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px',
    borderBottom: '1px solid #f1f5f9', flexShrink: 0, minHeight: 26,
  },
  navBtn: {
    background: 'rgba(0,0,0,0.07)', border: 'none', borderRadius: 3,
    width: 18, height: 18, fontSize: 13, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700,
    color: '#374151', flexShrink: 0,
  },
  navLabel: {
    flex: 1, fontSize: 10, color: '#374151', fontWeight: 600,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  navCount:  { fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', flexShrink: 0 },
  imageWrap: {
    flex: 1, overflowY: 'auto' as const, overflowX: 'auto' as const,
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    minHeight: 0, background: '#f8fafc',
  },
  placeholder: {
    padding: '30px 16px', color: '#9ca3af', fontSize: 11,
    fontStyle: 'italic' as const, textAlign: 'center' as const, alignSelf: 'center' as const,
  },
  errorMsg: {
    padding: '20px 16px', color: '#dc2626', fontSize: 11,
    textAlign: 'center' as const, alignSelf: 'center' as const,
  },
  zoomBar: {
    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px',
    borderTop: '1px solid #f1f5f9', flexShrink: 0,
  },
  zoomBtn: {
    background: '#374151', color: '#fff', border: 'none', borderRadius: 3,
    width: 20, height: 20, fontSize: 14, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center', padding: 0, fontWeight: 700, lineHeight: 1,
  },
  zoomLabel:    { fontSize: 10, color: '#374151', fontFamily: 'monospace', minWidth: 32, textAlign: 'center' as const },
  zoomResetBtn: {
    background: 'transparent', color: '#6b7280', border: '1px solid #d1d5db',
    borderRadius: 3, padding: '1px 6px', fontSize: 10, cursor: 'pointer', marginLeft: 2,
  },
  metaPanel: {
    overflowY:   'auto' as const,
    maxHeight:   200,
    borderTop:   '2px solid #e2e8f0',
    flexShrink:  0,
    background:  '#fafafa',
  },
  metaHint: {
    padding: '6px 10px', fontSize: 10, color: '#9ca3af', fontStyle: 'italic' as const,
  },
  regionBar: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
    borderBottom: '1px solid #f1f5f9', flexShrink: 0, background: '#f8fafc',
  },
  regionBtn: {
    background: 'transparent', color: '#374151', border: '1px solid #d1d5db',
    borderRadius: 3, padding: '2px 8px', fontSize: 10, fontWeight: 600,
    cursor: 'pointer', flexShrink: 0,
  },
  regionCount: { fontSize: 10, color: '#3b82f6', fontWeight: 700, fontFamily: 'monospace' },
  handle: {
    width: 10, height: 10, background: HEADER_COLOR,
    border: '2px solid #fff', boxShadow: `0 0 0 1px ${HEADER_COLOR}`,
  },
  outputHandle: {
    width: 10, height: 10, background: '#22c55e',
    border: '2px solid #fff', boxShadow: '0 0 0 1px #22c55e',
    top: 16,
  },
}
