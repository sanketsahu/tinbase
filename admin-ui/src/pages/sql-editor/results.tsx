import { Download } from 'lucide-react'
import type { api } from '../../api'
import { Button, CopyButton, Empty, Table, Td, Th, THead, TRow, ValueCell, valueTitle } from '../../components/ui'
import { copyText } from '../../lib/clipboard'
import { downloadFile, toCsv } from '../../lib/export'

export type SqlResult = Awaited<ReturnType<typeof api.sql>>

/**
 * Bottom results pane: sticky-header grid for row sets, statement summary for
 * DDL/DML, and a structured error panel (message + SQLSTATE + hint).
 * Double-click any cell to copy its value.
 */
export function ResultsPanel({ result }: { result: SqlResult | null }) {
  if (!result) return <Empty>Run a query to see results. ⌘⏎ / Ctrl+⏎</Empty>

  if (!result.ok) {
    return (
      <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-[13px] text-destructive">
        <div className="font-mono">{result.error}</div>
        {result.code && <div className="mt-1 text-xs text-destructive/70">SQLSTATE {result.code}</div>}
        {result.detail && <div className="mt-1 text-xs text-muted-foreground">{result.detail}</div>}
        {result.hint && <div className="mt-1 text-xs text-muted-foreground">Hint: {result.hint}</div>}
      </div>
    )
  }

  const rows = result.rows ?? []
  const cols = rows[0] ? Object.keys(rows[0]) : []

  if (cols.length === 0) {
    return <Empty>Statement executed{result.affectedRows != null ? ` · ${result.affectedRows} rows affected` : ''}.</Empty>
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-1.5 text-xs text-muted-foreground/80">
        <span>
          {result.rowCount} row{result.rowCount === 1 ? '' : 's'} · {result.ms} ms
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={() => downloadFile('results.csv', 'text/csv', toCsv(cols, rows))}>
            <Download size={12} /> CSV
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => downloadFile('results.json', 'application/json', JSON.stringify(rows, null, 2))}
          >
            <Download size={12} /> JSON
          </Button>
          <CopyButton variant="ghost" size="xs" label="results as JSON" value={() => JSON.stringify(rows, null, 2)}>
            Copy
          </CopyButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              {cols.map((c) => (
                <Th key={c} className="font-mono text-foreground/80">
                  {c}
                </Th>
              ))}
            </tr>
          </THead>
          <tbody>
            {rows.map((row, i) => (
              <TRow key={i}>
                {cols.map((c) => (
                  <Td
                    key={c}
                    className="max-w-90 cursor-cell truncate font-mono text-foreground/80"
                    title={valueTitle(row[c]) ?? 'Double-click to copy'}
                    onDoubleClick={() => {
                      const v = row[c]
                      void copyText(v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v), c)
                    }}
                  >
                    <ValueCell value={row[c]} />
                  </Td>
                ))}
              </TRow>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  )
}
