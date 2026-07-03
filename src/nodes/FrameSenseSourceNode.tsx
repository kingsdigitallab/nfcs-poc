/**
 * FrameSenseSourceNode — reads a pre-processed FrameSense collections folder
 * and emits one UnifiedRecord per shot, with the representative frame loaded
 * as a base64 imageDataUrl for downstream KCL vision inference.
 *
 * No runner — folder selection requires a direct user gesture.
 *
 * Expected folder structure (produced by FrameSense CLI):
 *   <root>/
 *     <collection>/
 *       <video>/
 *         [<clip>/]
 *           shots/
 *             001/
 *               shot.mp4
 *               middle.jpg  ← representative frame
 *               frames.json ← existing VLM answers + shotScale
 */

import { useState, useCallback, useRef } from 'react'
import { Handle, Position, useReactFlow, NodeProps } from '@xyflow/react'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FrameSenseSourceNodeData {
  folderName: string
  status: 'idle' | 'scanning' | 'success' | 'error'
  statusMessage: string
  collectionCount: number
  videoCount: number
  shotCount: number
  frameCount: number
  frameFilter: 'middle' | 'first' | 'last' | 'all'
  resultsVersion: number
  [key: string]: unknown
}

type FrameFilter = 'middle' | 'first' | 'last' | 'all'

interface ShotRecord {
  id: string
  _source: 'framesense'
  framesense: Record<string, unknown>
  imageDataUrl: string
  title: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const HEADER_COLOR = '#29394a'
const BTN_COLOR    = '#2d4a6a'

const STATUS_BORDER: Record<string, string> = {
  idle:     '#d6ccb5',
  scanning: '#3b82f6',
  success:  '#22c55e',
  error:    '#ef4444',
}

const HAS_API = typeof window !== 'undefined' && 'showDirectoryPicker' in window

// ── Helpers ────────────────────────────────────────────────────────────────────

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** Flatten a frames.json answer value to a plain string. */
function flattenValue(v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x ?? '')).join('; ')
  return String(v ?? '')
}

/**
 * Async generator: recursively finds all shot subdirectories under a root.
 * Yields { shotHandle, pathParts } where pathParts is the path from root
 * to the shot folder (e.g. ['Collection1', 'Video1', 'shots', '001']).
 * Skips hidden folders and node_modules.
 */
async function* findShotDirs(
  dir: FileSystemDirectoryHandle,
  pathParts: string[],
): AsyncGenerator<{ shotHandle: FileSystemDirectoryHandle; pathParts: string[] }> {
  for await (const [name, handle] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== 'directory') continue
    if (name.startsWith('.') || name === 'node_modules') continue

    if (name === 'shots') {
      const shotsHandle = handle as FileSystemDirectoryHandle
      for await (const [shotName, shotHandle] of (shotsHandle as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
        if (shotHandle.kind === 'directory') {
          yield {
            shotHandle: shotHandle as FileSystemDirectoryHandle,
            pathParts:  [...pathParts, 'shots', shotName],
          }
        }
      }
    } else {
      yield* findShotDirs(handle as FileSystemDirectoryHandle, [...pathParts, name])
    }
  }
}

/** Derive collection / video / clip / shot labels from the path components. */
function inferHierarchy(pathParts: string[]): {
  collection: string; video: string; clip: string; shot: string
} {
  // pathParts = [...hierarchy, 'shots', shotName]
  const shot           = pathParts[pathParts.length - 1] ?? ''
  const hierarchyParts = pathParts.slice(0, -2)
  return {
    collection: hierarchyParts[0] ?? '',
    video:      hierarchyParts[1] ?? '',
    clip:       hierarchyParts.slice(2).join('/'),
    shot,
  }
}

/**
 * Select which JPG files to load from a shot directory based on the filter.
 * Returns an ordered list of [filename, FileSystemFileHandle] pairs.
 */
async function selectFrameFiles(
  shotHandle: FileSystemDirectoryHandle,
  filter: FrameFilter,
): Promise<[string, FileSystemFileHandle][]> {
  const jpgs: [string, FileSystemFileHandle][] = []

  for await (const [name, handle] of (shotHandle as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (handle.kind !== 'file') continue
    if (!/\.(jpg|jpeg)$/i.test(name)) continue
    jpgs.push([name, handle as FileSystemFileHandle])
  }

  // Sort alphabetically so numbered frames (0001, 0002…) are in order
  jpgs.sort((a, b) => a[0].localeCompare(b[0]))

  if (filter === 'all' || jpgs.length === 0) return jpgs

  // Prefer files explicitly named middle/first/last, else pick by position
  const named = (keyword: string) =>
    jpgs.find(([n]) => n.toLowerCase().includes(keyword))

  if (filter === 'middle') {
    const found = named('middle') ?? jpgs[Math.floor(jpgs.length / 2)]
    return found ? [found] : []
  }
  if (filter === 'first') {
    const found = named('first') ?? jpgs[0]
    return found ? [found] : []
  }
  if (filter === 'last') {
    const found = named('last') ?? jpgs[jpgs.length - 1]
    return found ? [found] : []
  }
  return jpgs
}

/**
 * Read frames.json from a shot directory.
 * Returns the parsed object, or null if absent/malformed.
 */
async function readFramesJson(
  shotHandle: FileSystemDirectoryHandle,
): Promise<Record<string, Record<string, { value: unknown }>> | null> {
  try {
    const fh   = await shotHandle.getFileHandle('frames.json')
    const file = await fh.getFile()
    const text = await file.text()
    return JSON.parse(text) as Record<string, Record<string, { value: unknown }>>
  } catch {
    return null
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function FrameSenseSourceNode({ id, data }: NodeProps) {
  const { updateNodeData } = useReactFlow()
  const d = data as FrameSenseSourceNodeData

  const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const [progress, setProgress] = useState('')

  const frameFilter  = (d.frameFilter  as FrameFilter | undefined) ?? 'middle'
  const folderName   = (d.folderName   as string      | undefined) ?? ''
  const status       = (d.status       as string      | undefined) ?? 'idle'
  const borderColor  = STATUS_BORDER[status] ?? '#d6ccb5'

  const doScan = useCallback(async (rootHandle: FileSystemDirectoryHandle) => {
    clearNodeResults(id)
    updateNodeData(id, {
      status:          'scanning',
      statusMessage:   'Scanning…',
      folderName:      rootHandle.name,
      collectionCount: 0,
      videoCount:      0,
      shotCount:       0,
      frameCount:      0,
      resultsVersion:  0,
    })
    setProgress('Finding shots…')

    const records: ShotRecord[] = []
    const collections = new Set<string>()
    const videos      = new Set<string>()
    let shotCount     = 0
    let frameCount    = 0

    try {
      for await (const { shotHandle, pathParts } of findShotDirs(rootHandle, [])) {
        shotCount++
        setProgress(`Found ${shotCount} shot${shotCount !== 1 ? 's' : ''}…`)

        const hier      = inferHierarchy(pathParts)
        const framesJson = await readFramesJson(shotHandle)
        const frameFiles = await selectFrameFiles(shotHandle, frameFilter)

        if (hier.collection) collections.add(hier.collection)
        if (hier.video)      videos.add(`${hier.collection}/${hier.video}`)

        for (const [filename, fileHandle] of frameFiles) {
          frameCount++
          setProgress(`Loading frame ${frameCount}…`)

          let imageDataUrl = ''
          try {
            const file = await fileHandle.getFile()
            imageDataUrl = await readFileAsDataURL(file)
          } catch {
            continue
          }

          // Flatten existing answers from frames.json for this frame
          const framesenseFields: Record<string, unknown> = {
            collection: hier.collection,
            video:      hier.video,
            clip:       hier.clip,
            shot:       hier.shot,
            frameFile:  filename,
          }

          if (framesJson) {
            // Try exact filename match, then try without extension for named frames
            const frameKey = framesJson[filename]
              ?? framesJson[filename.replace(/\.(jpg|jpeg)$/i, '')]
              ?? null

            if (frameKey) {
              for (const [questionKey, entry] of Object.entries(frameKey)) {
                if (questionKey === 'shot_scale') {
                  framesenseFields.shotScale = flattenValue(entry.value)
                } else {
                  framesenseFields[questionKey] = flattenValue(entry.value)
                }
              }
            }
          }

          const label = [hier.collection, hier.video, hier.clip, hier.shot, filename]
            .filter(Boolean)
            .join(' / ')

          records.push({
            id:           crypto.randomUUID(),
            _source:      'framesense',
            framesense:   framesenseFields,
            imageDataUrl,
            title:        label,
          })
        }
      }

      setProgress('')
      const version = setNodeResults(id, records as unknown as Record<string, unknown>[])
      updateNodeData(id, {
        status:          'success',
        statusMessage:   `✓ ${frameCount} frame${frameCount !== 1 ? 's' : ''} from ${shotCount} shots`,
        collectionCount: collections.size,
        videoCount:      videos.size,
        shotCount,
        frameCount,
        resultsVersion:  version,
      })
    } catch (err) {
      setProgress('')
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [id, updateNodeData, frameFilter])

  const handlePickFolder = useCallback(async () => {
    if (!HAS_API) return
    try {
      const handle = await (window as unknown as {
        showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>
      }).showDirectoryPicker()
      dirHandleRef.current = handle
      await doScan(handle)
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      const msg = err instanceof Error ? err.message : String(err)
      updateNodeData(id, { status: 'error', statusMessage: `✗ ${msg}` })
    }
  }, [doScan, id, updateNodeData])

  const handleRescan = useCallback(async () => {
    if (!dirHandleRef.current) return
    await doScan(dirHandleRef.current)
  }, [doScan])

  const collectionCount = (d.collectionCount as number | undefined) ?? 0
  const videoCount      = (d.videoCount      as number | undefined) ?? 0
  const shotCount       = (d.shotCount       as number | undefined) ?? 0
  const frameCount      = (d.frameCount      as number | undefined) ?? 0
  const isScanning      = status === 'scanning'

  return (
    <div style={{ ...styles.card, borderColor }}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>FrameSense Source</span>
        {d.statusMessage ? (
          <span style={styles.headerStatus}>{d.statusMessage as string}</span>
        ) : null}
      </div>

      <div style={styles.body}>
        {!HAS_API ? (
          <div style={styles.warn}>Requires Chrome or Edge 86+</div>
        ) : (
          <>
            {/* Frame filter */}
            <div style={styles.row}>
              <span style={styles.label}>Frame</span>
              <select
                style={styles.select}
                value={frameFilter}
                onChange={e => updateNodeData(id, { frameFilter: e.target.value as FrameFilter })}
                disabled={isScanning}
                className="nodrag"
              >
                <option value="middle">Middle (recommended)</option>
                <option value="first">First</option>
                <option value="last">Last</option>
                <option value="all">All frames</option>
              </select>
            </div>

            {/* Folder name after pick */}
            {folderName ? (
              <div style={styles.folderInfo}>
                <span style={styles.folderIcon}>🎬</span>
                <span style={styles.folderName} title={folderName}>{folderName}</span>
              </div>
            ) : null}

            {/* Progress during scan */}
            {isScanning && progress ? (
              <div style={styles.progressText}>{progress}</div>
            ) : null}

            {/* Stats after scan */}
            {!isScanning && shotCount > 0 ? (
              <div style={styles.statsGrid}>
                <div style={styles.statCell}>
                  <span style={styles.statNum}>{collectionCount}</span>
                  <span style={styles.statLabel}>collections</span>
                </div>
                <div style={styles.statCell}>
                  <span style={styles.statNum}>{videoCount}</span>
                  <span style={styles.statLabel}>videos</span>
                </div>
                <div style={styles.statCell}>
                  <span style={styles.statNum}>{shotCount}</span>
                  <span style={styles.statLabel}>shots</span>
                </div>
                <div style={styles.statCell}>
                  <span style={styles.statNum}>{frameCount}</span>
                  <span style={styles.statLabel}>frames</span>
                </div>
              </div>
            ) : null}

            {/* Hint when idle and nothing picked */}
            {!folderName && !isScanning ? (
              <div style={styles.hint}>
                Pick a folder pre-processed by FrameSense CLI
                (<code style={styles.code}>make_shots_scenedetect</code> +{' '}
                <code style={styles.code}>make_frames_ffmpeg</code>)
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        {HAS_API && dirHandleRef.current && !isScanning && (
          <button
            style={{ ...styles.btn, background: '#33302a', marginRight: 6 }}
            onClick={handleRescan}
            className="nodrag"
          >
            ↺ Re-scan
          </button>
        )}
        {HAS_API && (
          <button
            style={{ ...styles.btn, background: BTN_COLOR, opacity: isScanning ? 0.5 : 1 }}
            onClick={handlePickFolder}
            disabled={isScanning}
            className="nodrag"
          >
            {isScanning ? 'Scanning…' : '🎬 Pick Folder'}
          </button>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="results"
        style={styles.outputHandle}
        title="Shot records with imageDataUrl"
      />
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = {
  card: {
    background:   '#fffdf7',
    border:       '2px solid #d6ccb5',
    borderRadius: 8,
    minWidth:     240,
    maxWidth:     280,
    boxShadow:    '0 1px 4px rgba(50,42,26,0.10)',
    position:     'relative' as const,
    transition:   'border-color 0.25s',
  },
  header: {
    height:        32,
    background:    HEADER_COLOR,
    borderRadius:  '6px 6px 0 0',
    padding:       '0 10px',
    display:       'flex',
    alignItems:    'center',
    justifyContent:'space-between',
    gap:           8,
  },
  headerTitle: {
    color:      '#fff',
    fontWeight: 700,
    fontSize:   12,
    flexShrink: 0,
  },
  headerStatus: {
    fontSize:       10,
    fontWeight:     600,
    color:          '#93c5fd',
    overflow:       'hidden',
    textOverflow:   'ellipsis',
    whiteSpace:     'nowrap' as const,
  },
  body: {
    padding:       '10px 12px 6px',
    display:       'flex',
    flexDirection: 'column' as const,
    gap:           8,
  },
  row: {
    display:    'flex',
    alignItems: 'center',
    gap:        6,
  },
  label: {
    fontSize:   11,
    color:      '#8a8168',
    width:      42,
    flexShrink: 0,
    fontFamily: 'monospace',
  },
  select: {
    flex:         1,
    fontSize:     11,
    padding:      '2px 4px',
    border:       '1px solid #d6ccb5',
    borderRadius: 4,
    outline:      'none',
    height:       22,
  },
  folderInfo: {
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    padding:      '4px 6px',
    background:   '#f0f9ff',
    borderRadius: 4,
    border:       '1px solid #bae6fd',
  },
  folderIcon: {
    fontSize:   13,
    flexShrink: 0,
  },
  folderName: {
    fontSize:      11,
    fontWeight:    600,
    color:         '#0369a1',
    flex:          1,
    overflow:      'hidden',
    textOverflow:  'ellipsis',
    whiteSpace:    'nowrap' as const,
  },
  progressText: {
    fontSize:   11,
    color:      '#3b82f6',
    fontStyle:  'italic' as const,
    fontFamily: 'monospace',
  },
  statsGrid: {
    display:             'grid',
    gridTemplateColumns: '1fr 1fr 1fr 1fr',
    gap:                 4,
    padding:             '6px 4px',
    background:          '#f8fafc',
    borderRadius:        4,
    border:              '1px solid #e2e8f0',
  },
  statCell: {
    display:       'flex',
    flexDirection: 'column' as const,
    alignItems:    'center',
    gap:           1,
  },
  statNum: {
    fontSize:   13,
    fontWeight: 700,
    color:      '#1c2a3a',
  },
  statLabel: {
    fontSize: 9,
    color:    '#b0a891',
  },
  hint: {
    fontSize:   10,
    color:      '#b0a891',
    lineHeight: 1.5,
  },
  code: {
    fontSize:     10,
    background:   '#f3f4f6',
    borderRadius: 3,
    padding:      '0 3px',
    fontFamily:   'monospace',
  },
  warn: {
    fontSize:    11,
    color:       '#ef4444',
    padding:     '4px 0',
    textAlign:   'center' as const,
  },
  footer: {
    padding:        '6px 10px 8px',
    display:        'flex',
    justifyContent: 'flex-end',
    alignItems:     'center',
  },
  btn: {
    color:        '#fff',
    border:       'none',
    borderRadius: 5,
    padding:      '4px 12px',
    fontSize:     11,
    fontWeight:   600,
    cursor:       'pointer',
  },
  outputHandle: {
    width:     10,
    height:    10,
    background:'#22c55e',
    border:    '2px solid #fff',
    boxShadow: '0 0 0 1px #22c55e',
  },
}
