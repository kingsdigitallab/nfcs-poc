/**
 * runSampleDataNode — runner for SampleDataSourceNode.
 *
 * Fetches pre-packaged collection files from public/fixtures/ over HTTP,
 * extracts content via extractFileContent (reusing all existing logic for
 * XML, text, PDF and image), then writes results to the store using the
 * same typed-partition pattern as LocalFolderSourceNode.
 *
 * `loadSampleFiles` is exported separately so the node's "Load Selected"
 * button can call it directly (interactive path) while Run All goes via the
 * runner (automation path) — both share identical behaviour.
 */

import type { Edge, Node } from '@xyflow/react'
import type { NodeRunner }  from './nodeRunners'
import { setNodeResults, clearNodeResults } from '../store/resultsStore'
import { extractFileContent, type FileRecord } from './fileReaders'
import { parseDelimited } from './csvParser'

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single file entry from the collections manifest, persisted in node data. */
export interface SelectedFile {
  url:      string
  filename: string
  label:    string
  type:     'xml' | 'text' | 'pdf' | 'image' | 'csv'
}

// ── Shared loader ─────────────────────────────────────────────────────────────

/**
 * Fetch and extract every file in `files`, partition by contentType, write the
 * results store (plain + typed), and update node data with counts/status.
 *
 * Never throws — errors per-file are logged and counted; the node is left in
 * 'ready' or 'error' status, never in an unrecoverable state.
 */
export async function loadSampleFiles(
  nodeId:        string,
  files:         SelectedFile[],
  packageTitle:  string,
  updateNodeData: (id: string, data: Record<string, unknown>) => void,
): Promise<void> {
  // Clear previous results for all partitions
  clearNodeResults(nodeId)
  clearNodeResults(`${nodeId}:pdf`)
  clearNodeResults(`${nodeId}:xml`)
  clearNodeResults(`${nodeId}:text`)
  clearNodeResults(`${nodeId}:image`)
  clearNodeResults(`${nodeId}:csv`)

  if (files.length === 0) {
    updateNodeData(nodeId, {
      status:         'idle',
      statusMessage:  'No files selected',
      count:          0,
      pdfCount:       0,
      xmlCount:       0,
      textCount:      0,
      imageCount:     0,
      csvCount:       0,
      resultsVersion: 0,
    })
    return
  }

  updateNodeData(nodeId, {
    status:        'loading',
    statusMessage: `Loading ${files.length} file${files.length !== 1 ? 's' : ''}…`,
  })

  const records: FileRecord[] = []
  const csvRows: FileRecord[] = []
  const failed: string[]      = []

  for (const sf of files) {
    try {
      const res = await fetch(sf.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // CSV/TSV: parse into column-keyed row records, matching LocalFileSourceNode.
      // Rows are added to both the typed :csv partition and the plain "All" store.
      if (sf.type === 'csv' || /\.(csv|tsv)$/i.test(sf.filename)) {
        const text = await res.text()
        const { records: rows } = parseDelimited(text, 'auto', true, true, sf.filename)
        const typed = rows as unknown as FileRecord[]
        records.push(...typed)
        csvRows.push(...typed)
      } else {
        const blob = await res.blob()
        const file = new File([blob], sf.filename, { type: blob.type || 'application/octet-stream' })
        const rec  = await extractFileContent(file, sf.filename, packageTitle)
        if (rec) records.push(rec)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      failed.push(`${sf.filename}: ${msg}`)
      console.warn(`[SampleData] failed to load ${sf.filename}:`, msg)
    }
  }

  const pdfs   = records.filter(r => r.contentType === 'pdf_text')
  const xmls   = records.filter(r => r.contentType === 'xml')
  const texts  = records.filter(r => r.contentType === 'text')
  const images = records.filter(r => r.contentType === 'image')

  const version = setNodeResults(nodeId, records as unknown as Record<string, unknown>[])
  setNodeResults(`${nodeId}:pdf`,   pdfs     as unknown as Record<string, unknown>[])
  setNodeResults(`${nodeId}:xml`,   xmls     as unknown as Record<string, unknown>[])
  setNodeResults(`${nodeId}:text`,  texts    as unknown as Record<string, unknown>[])
  setNodeResults(`${nodeId}:image`, images   as unknown as Record<string, unknown>[])
  setNodeResults(`${nodeId}:csv`,   csvRows  as unknown as Record<string, unknown>[])

  const ok = records.length
  const nf = failed.length

  updateNodeData(nodeId, {
    status:         nf > 0 ? 'error' : 'ready',
    statusMessage:  nf > 0 ? `⚠ ${ok} loaded, ${nf} failed` : `✓ ${ok} file${ok !== 1 ? 's' : ''} loaded`,
    count:          ok,
    pdfCount:       pdfs.length,
    xmlCount:       xmls.length,
    textCount:      texts.length,
    imageCount:     images.length,
    csvCount:       csvRows.length,
    resultsVersion: version,
  })
}

// ── NodeRunner ────────────────────────────────────────────────────────────────

export const runSampleDataNode: NodeRunner = async (
  nodeId,
  getNodes,
  _edges: Edge[],
  updateNodeData,
) => {
  const node = getNodes().find((n: Node) => n.id === nodeId)
  if (!node) return

  const d            = node.data as Record<string, unknown>
  const selectedFiles = (d.selectedFiles as SelectedFile[] | undefined) ?? []
  const packageTitle  = (d.packageTitle  as string        | undefined) ?? ''

  await loadSampleFiles(nodeId, selectedFiles, packageTitle, updateNodeData)
}
