/**
 * gisReaders.ts — Parse GeoJSON and ESRI Shapefiles from the File System
 * Access API, returning GeoJSON FeatureCollections for map overlay use.
 *
 * Reprojection: shpjs bundles proj4 and reprojects to WGS84 automatically
 * when a .prj file is supplied. GeoJSON is always WGS84 per RFC 7946.
 * Shapefiles without a .prj are used as-is and may display incorrectly if
 * they are not already in WGS84 — the layer carries a `noPrj` warning flag.
 */

// shpjs has no bundled TypeScript types
// @ts-ignore
import { combine, parseShp, parseDbf } from 'shpjs'

export interface GisLayer {
  name: string
  geojson: GeoJSON.FeatureCollection
  featureCount: number
  format: 'geojson' | 'shapefile'
  /** True when a shapefile was loaded without a .prj — coordinates may not be WGS84 */
  noPrj?: boolean
}

export const GEOJSON_EXTS = ['.geojson', '.json']
export const SHAPEFILE_EXTS = ['.shp']

// ── GeoJSON ───────────────────────────────────────────────────────────────────

export async function parseGeoJsonFile(file: File): Promise<GisLayer | null> {
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    const fc: GeoJSON.FeatureCollection | null =
      parsed.type === 'FeatureCollection'
        ? parsed
        : parsed.type === 'Feature'
          ? { type: 'FeatureCollection', features: [parsed] }
          : null
    if (!fc) return null
    return {
      name: file.name.replace(/\.(geo)?json$/i, ''),
      geojson: fc,
      featureCount: fc.features?.length ?? 0,
      format: 'geojson',
    }
  } catch {
    return null
  }
}

// ── Shapefile ─────────────────────────────────────────────────────────────────

/**
 * Parse a shapefile from file handles.
 * Reads the optional .prj file and passes its WKT string to shpjs so that
 * proj4 can reproject non-WGS84 coordinates (e.g. OSGB/BNG) to WGS84.
 */
export async function parseShapefileHandles(
  shpHandle: FileSystemFileHandle,
  dbfHandle: FileSystemFileHandle,
  prjHandle?: FileSystemFileHandle,
): Promise<GisLayer | null> {
  try {
    const files = await Promise.all([
      shpHandle.getFile(),
      dbfHandle.getFile(),
      prjHandle ? prjHandle.getFile() : null,
    ])
    const [shpBuf, dbfBuf, prjText] = await Promise.all([
      files[0].arrayBuffer(),
      files[1].arrayBuffer(),
      files[2] ? files[2].text() : Promise.resolve(null),
    ])

    // parseShp(buffer, prjString) reprojects via proj4 when prjString is provided
    const geojson = combine([
      parseShp(shpBuf, prjText ?? undefined),
      parseDbf(dbfBuf),
    ]) as GeoJSON.FeatureCollection

    return {
      name:         shpHandle.name.replace(/\.shp$/i, ''),
      geojson,
      featureCount: geojson.features?.length ?? 0,
      format:       'shapefile',
      noPrj:        prjText === null,
    }
  } catch {
    return null
  }
}

// ── Directory scan ────────────────────────────────────────────────────────────

/**
 * Scan a directory for GeoJSON files and complete Shapefiles (.shp + .dbf).
 * Also looks for .prj companions for automatic CRS reprojection to WGS84.
 */
export async function scanGisFiles(
  dirHandle: FileSystemDirectoryHandle,
): Promise<GisLayer[]> {
  const fileHandles = new Map<string, FileSystemFileHandle>()

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      fileHandles.set(name.toLowerCase(), handle as FileSystemFileHandle)
    }
  }

  const layers: GisLayer[] = []

  for (const [name, handle] of fileHandles) {
    if (name.endsWith('.geojson') || (name.endsWith('.json') && !name.endsWith('.lock.json'))) {
      const file = await handle.getFile()
      const layer = await parseGeoJsonFile(file)
      if (layer) layers.push(layer)
    }
  }

  for (const [name, handle] of fileHandles) {
    if (!name.endsWith('.shp')) continue
    const base = name.slice(0, -4)
    const dbfHandle = fileHandles.get(base + '.dbf')
    if (!dbfHandle) continue
    const prjHandle = fileHandles.get(base + '.prj') // optional but enables reprojection
    const layer = await parseShapefileHandles(handle, dbfHandle, prjHandle)
    if (layer) layers.push(layer)
  }

  return layers
}
