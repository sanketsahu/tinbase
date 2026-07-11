/**
 * Serializes rows to a CSV string, escaping values that contain quotes,
 * commas, or newlines. Objects are JSON-encoded; `null`/`undefined` become
 * empty cells.
 *
 * @param cols - Ordered column keys to emit as the header and select from each row.
 * @param rows - The rows to serialize, keyed by column name.
 * @returns The CSV document as a single string.
 */
export function toCsv(cols: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
}

/**
 * Triggers a browser download of an in-memory body as a file.
 *
 * @param name - The suggested filename for the download.
 * @param mime - The MIME type of the file contents.
 * @param body - The file contents to download.
 */
export function downloadFile(name: string, mime: string, body: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: mime }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}
