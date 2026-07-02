/**
 * fileReaders.ts — Client-side file content extraction utilities.
 *
 * Handles text, XML/TEI, PDF (via pdfjs-dist) and image files selected from
 * a local folder via the File System Access API.
 */

import * as pdfjsLib from 'pdfjs-dist'

// Use CDN worker to avoid Vite bundler issues with the pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentType = 'text' | 'xml' | 'pdf_text' | 'image'

export interface FileRecord {
  id: string
  filename: string
  /** Relative path within the selected folder (just the filename for top-level) */
  path: string
  contentType: ContentType
  /** Extracted text, or base64 data URL for images */
  content: string
  mimeType: string
  sizeBytes: number
  sourceFolder: string
}

// ── Extension sets ────────────────────────────────────────────────────────────

export const TEXT_EXTS   = ['.txt', '.md', '.csv', '.tsv']
export const XML_EXTS    = ['.xml', '.html', '.tei', '.tei.xml']
export const PDF_EXTS    = ['.pdf']
export const IMAGE_EXTS  = ['.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp']

export const TYPE_LABEL_MAP: Record<string, string[]> = {
  pdf:   PDF_EXTS,
  xml:   XML_EXTS,
  text:  TEXT_EXTS,
  image: IMAGE_EXTS,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getExt(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.tei.xml')) return '.tei.xml'
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot) : ''
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
  const pdf = await loadingTask.promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()
    const pageText = textContent.items
      .map(item => ('str' in item ? (item.str as string) : ''))
      .join(' ')
    pages.push(pageText.trim())
  }
  return pages.filter(Boolean).join('\n')
}

export async function extractPdfPages(
  file: File,
  scale    = 1.5,
  maxPages = 20,
  onPage?: (
    record: FileRecord & Record<string, unknown>,
    pageNum: number,
    totalPages: number,
  ) => void,
): Promise<(FileRecord & Record<string, unknown>)[]> {
  const arrayBuffer = await file.arrayBuffer()
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const total       = pdf.numPages
  const cap         = Math.min(total, maxPages)
  const records: (FileRecord & Record<string, unknown>)[] = []

  for (let i = 1; i <= cap; i++) {
    const page     = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas   = document.createElement('canvas')
    canvas.width   = viewport.width
    canvas.height  = viewport.height
    const ctx = canvas.getContext('2d')!
    await page.render({ canvasContext: ctx, viewport } as unknown as Parameters<typeof page.render>[0]).promise
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)

    const record: FileRecord & Record<string, unknown> = {
      id:           crypto.randomUUID(),
      filename:     `${file.name} — page ${i}`,
      path:         file.name,
      contentType:  'image' as ContentType,
      content:      dataUrl,
      mimeType:     'image/jpeg',
      sizeBytes:    Math.round(dataUrl.length * 0.75),
      sourceFolder: '',
      pageNumber:   i,
      totalPages:   total,
      sourcePdf:    file.name,
    }
    records.push(record)
    onPage?.(record, i, total)
  }
  return records
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Extract text / base64 content from a single File.
 * Returns null for unsupported file types (caller should skip silently).
 */
export async function extractFileContent(
  file: File,
  relativePath: string,
  folderName: string,
): Promise<FileRecord | null> {
  const ext = getExt(file.name)

  let contentType: ContentType
  let content: string
  const mimeType = file.type || 'application/octet-stream'

  if (TEXT_EXTS.includes(ext)) {
    contentType = 'text'
    content = await file.text()
  } else if (XML_EXTS.includes(ext)) {
    contentType = 'xml'
    content = await file.text()
  } else if (PDF_EXTS.includes(ext)) {
    contentType = 'pdf_text'
    content = await extractPdfText(file)
  } else if (IMAGE_EXTS.includes(ext)) {
    contentType = 'image'
    content = await readAsDataURL(file)
  } else {
    return null
  }

  return {
    id: crypto.randomUUID(),
    filename: file.name,
    path: relativePath,
    contentType,
    content,
    mimeType,
    sizeBytes: file.size,
    sourceFolder: folderName,
  }
}

/**
 * Scan a directory handle (non-recursive), filtering by type labels and capping
 * at max files. Returns the extracted records plus summary counts.
 */
export async function scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  types: string[],
  max: number,
): Promise<{ files: FileRecord[]; totalFound: number; skipped: number }> {
  const allowedExts = new Set<string>()
  for (const type of types) {
    for (const ext of TYPE_LABEL_MAP[type] ?? []) {
      allowedExts.add(ext)
    }
  }

  const files: FileRecord[] = []
  let totalFound = 0
  let skipped = 0

  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind !== 'file') continue
    const ext = getExt(name)
    if (!allowedExts.has(ext)) continue

    totalFound++

    if (files.length >= max) {
      skipped++
      continue
    }

    try {
      const file = await (handle as FileSystemFileHandle).getFile()
      const record = await extractFileContent(file, name, dirHandle.name)
      if (record) {
        files.push(record)
      } else {
        skipped++
      }
    } catch {
      skipped++
    }
  }

  return { files, totalFound, skipped }
}
