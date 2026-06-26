/**
 * csvParser.ts — shared CSV/TSV parser used by LocalFileSourceNode and
 * the Sample Data node loader.
 *
 * Extracted from LocalFileSourceNode so that the Sample Data node can
 * parse CSV/TSV fixture files into column-keyed row records instead of
 * treating them as opaque text.
 */

// ── Delimiter detection ────────────────────────────────────────────────────────

export function detectDelimiter(firstLine: string, fileName: string): string {
  if (fileName.endsWith('.tsv')) return '\t'
  const counts = {
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ',':  (firstLine.match(/,/g)  ?? []).length,
    ';':  (firstLine.match(/;/g)  ?? []).length,
    '|':  (firstLine.match(/\|/g) ?? []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

// ── RFC-4180-compliant field splitter ─────────────────────────────────────────

export function splitLine(line: string, delimiter: string): string[] {
  const result: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      result.push(field); field = ''
    } else {
      field += ch
    }
  }
  result.push(field)
  return result
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse a delimited text string into an array of column-keyed records.
 *
 * @param text            Raw file content
 * @param delimiterSetting `'auto'` to detect from the first line, or an
 *                         explicit delimiter character
 * @param hasHeader       Treat the first row as column headers (default true)
 * @param autoCast        Coerce numeric strings to numbers (default true)
 * @param fileName        Used by auto-detection to recognise `.tsv` files
 */
export function parseDelimited(
  text: string,
  delimiterSetting: string,
  hasHeader: boolean,
  autoCast: boolean,
  fileName: string,
): { records: Record<string, unknown>[]; columns: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return { records: [], columns: [] }

  const delim = delimiterSetting === 'auto'
    ? detectDelimiter(lines[0], fileName)
    : delimiterSetting

  const rawHeaders = hasHeader
    ? splitLine(lines[0], delim).map(h => h.trim())
    : splitLine(lines[0], delim).map((_, i) => `col${i + 1}`)

  const dataLines = hasHeader ? lines.slice(1) : lines
  const colCount  = rawHeaders.length

  const records = dataLines.map(line => {
    const values = splitLine(line, delim)
    const record: Record<string, unknown> = {}
    for (let i = 0; i < colCount; i++) {
      const raw = (values[i] ?? '').trim()
      if (autoCast && raw !== '' && !isNaN(Number(raw))) {
        record[rawHeaders[i]] = Number(raw)
      } else {
        record[rawHeaders[i]] = raw
      }
    }
    return record
  })

  return { records, columns: rawHeaders }
}
