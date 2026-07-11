import { ArrowUpRight, KeyRound, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, type TableInfo } from '../../api'
import { Button, Sheet, SheetClose, Spinner } from '../../components/ui'
import { Cell } from './cells'
import { quickSearchPair, TEXTISH, type CellAnchor } from './model'

export type Fk = TableInfo['foreignKeys'][number]

const targetNameOf = (fk: Fk) => fk.target.split('.').pop()!
const isAuthUsers = (fk: Fk) => fk.target === 'auth.users'

/** Columns worth previewing next to the referenced key. */
function previewColsFor(info: TableInfo | undefined, fk: Fk): string[] {
  if (!info) return []
  return info.columns
    .filter((c) => !fk.targetColumns.includes(c.name) && TEXTISH.has(c.type))
    .slice(0, 2)
    .map((c) => c.name)
}

/**
 * Fetches rows from an FK's target table, supporting exact-key lookup, search,
 * and pagination. `auth.users` is not exposed over REST, so it is resolved
 * through the auth admin API instead.
 */
async function fetchTargetRows(
  fk: Fk,
  info: TableInfo | undefined,
  opts: { search?: string; page?: number; perPage?: number; exact?: unknown }
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  if (isAuthUsers(fk)) {
    let users = (await api.users()) as Record<string, unknown>[]
    if (opts.exact !== undefined) users = users.filter((u) => String(u.id) === String(opts.exact))
    if (opts.search) {
      const q = opts.search.toLowerCase()
      users = users.filter((u) => String(u.email ?? '').toLowerCase().includes(q) || String(u.id).includes(q))
    }
    return { rows: users, total: users.length }
  }
  const filters: [string, string][] = []
  if (opts.exact !== undefined) filters.push([fk.targetColumns[0], `eq.${opts.exact}`])
  if (opts.search?.trim() && info) {
    const pair = quickSearchPair(info.columns, opts.search)
    if (pair) filters.push(pair)
  }
  const perPage = opts.perPage ?? 100
  return api.rows(targetNameOf(fk), {
    limit: opts.exact !== undefined ? 1 : perPage,
    offset: (opts.page ?? 0) * perPage,
    order: info?.primaryKey[0] ? `${info.primaryKey[0]}.asc` : undefined,
    filters,
  })
}

/* ── peek popover: the → arrow on an FK cell ────────────────────────────── */

/**
 * Popover that previews the single referenced record for an FK cell (triggered
 * by the → arrow), with an option to open the target table.
 *
 * @param props.fk - The foreign key describing the reference.
 * @param props.value - The referencing cell value used to look up the target row.
 * @param props.anchor - Viewport rect of the originating cell used to position the popover.
 * @param props.tables - Known tables, used to resolve target column metadata.
 * @param props.onClose - Called to dismiss the popover.
 * @param props.onOpenTable - Called with the target table name to navigate to it.
 */
export function FkPeek({
  fk,
  value,
  anchor,
  tables,
  onClose,
  onOpenTable,
}: {
  fk: Fk
  value: unknown
  anchor: CellAnchor
  tables: TableInfo[]
  onClose: () => void
  onOpenTable: (table: string) => void
}) {
  const info = tables.find((t) => t.name === targetNameOf(fk))
  const [row, setRow] = useState<Record<string, unknown> | null | undefined>(undefined)

  useEffect(() => {
    fetchTargetRows(fk, info, { exact: value }).then(
      ({ rows }) => setRow(rows[0] ?? null),
      () => setRow(null)
    )
  }, [fk, info, value])

  const keyCol = isAuthUsers(fk) ? 'id' : fk.targetColumns[0]
  const preview = isAuthUsers(fk) ? ['email'] : previewColsFor(info, fk)
  const typeOf = (name: string) => (isAuthUsers(fk) ? (name === 'id' ? 'uuid' : 'text') : info?.columns.find((c) => c.name === name)?.type ?? '')

  const width = 400
  const top = Math.min(anchor.top + anchor.height + 4, window.innerHeight - 190)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 12))

  return createPortal(
    <>
      <div className="fixed inset-0 z-[70]" onClick={onClose} />
      <div
        style={{ position: 'fixed', top, left, width }}
        className="z-[80] overflow-hidden rounded-md border border-muted-foreground bg-card shadow-[0_16px_48px_rgba(0,0,0,0.6)] animate-[fade-in_.1s_ease-out]"
      >
        <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
          Referencing record from <code className="font-mono text-foreground">{fk.target}</code>:
        </p>
        {row === undefined ? (
          <Spinner />
        ) : row === null ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">No matching record found.</p>
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {[keyCol, ...preview].map((c, i) => (
                  <th key={c} className="border-b border-r border-border px-3 py-1.5 text-left font-normal last:border-r-0">
                    <span className="flex items-center gap-1.5">
                      {i === 0 && <KeyRound size={10} className="text-brand" />}
                      <span className="font-mono font-medium text-foreground">{c}</span>
                      <span className="text-[11px] text-muted-foreground/60">{typeOf(c)}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {[keyCol, ...preview].map((c) => (
                  <td key={c} className="max-w-[220px] truncate border-r border-border/60 px-3 py-2 font-mono text-foreground/80 last:border-r-0">
                    <Cell value={row[c]} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        )}
        {!isAuthUsers(fk) && (
          <div className="flex justify-end border-t border-border px-2 py-1.5">
            <Button variant="outline" size="xs" onClick={() => onOpenTable(targetNameOf(fk))}>
              Open table
            </Button>
          </div>
        )}
      </div>
    </>,
    document.body
  )
}

/* ── record picker sheet: browse the target table and pick a row ────────── */

/**
 * Sheet for browsing the FK's target table (searchable, paginated) and picking
 * a record to reference, highlighting the currently referenced row.
 *
 * @param props.fk - The foreign key describing the reference.
 * @param props.tables - Known tables, used to resolve the target table's columns.
 * @param props.currentKey - Current value of the (first) referencing column, for highlighting.
 * @param props.onPick - Called with the mapped referencing-column values for the chosen row.
 * @param props.onClose - Called to dismiss the sheet.
 */
export function ForeignKeySheet({
  fk,
  tables,
  currentKey,
  onPick,
  onClose,
}: {
  fk: Fk
  tables: TableInfo[]
  currentKey: unknown
  onPick: (values: Record<string, unknown>) => void
  onClose: () => void
}) {
  const info = tables.find((t) => t.name === targetNameOf(fk))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')

  const PER_PAGE = 100
  const authUsers = isAuthUsers(fk)

  const displayCols = authUsers
    ? ['id', 'email', 'created_at']
    : info
      ? [...fk.targetColumns, ...info.columns.map((c) => c.name).filter((n) => !fk.targetColumns.includes(n))].slice(0, 6)
      : fk.targetColumns

  const load = useCallback(() => {
    setError('')
    fetchTargetRows(fk, info, { search, page, perPage: PER_PAGE }).then(
      ({ rows, total }) => {
        setRows(rows)
        setTotal(total)
      },
      (e) => setError((e as Error).message)
    )
  }, [fk, info, search, page])

  useEffect(() => {
    void load()
  }, [load])

  const pages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <Sheet
      open
      onClose={onClose}
      flush
      width="w-[640px]"
      title={
        <span>
          Select a record to reference from{' '}
          <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{fk.target}</code>
        </span>
      }
      footer={
        <>
          <span className="text-xs text-muted-foreground/80">
            {total.toLocaleString()} record{total === 1 ? '' : 's'}
            {pages > 1 && ` · page ${page + 1} of ${pages}`}
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-1">
              <Button variant="outline" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <Button variant="outline" size="xs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          )}
          <SheetClose asChild>
            <Button variant="outline" className="ml-auto">
              Cancel
            </Button>
          </SheetClose>
        </>
      }
    >
      <div className="flex h-full flex-col">
        <div className="relative border-b border-border">
          <Search size={13} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input
            autoFocus
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder={`Search ${targetNameOf(fk)}…`}
            className="h-10 w-full bg-transparent pl-10 pr-10 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/80 hover:text-foreground" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {error && <p className="px-4 py-3 text-xs text-destructive">{error}</p>}
          {!error && rows === null && <Spinner />}
          {!error && rows !== null && rows.length === 0 && (
            <p className="py-10 text-center text-xs text-muted-foreground/60">No records{search ? ' match your search' : ''}.</p>
          )}
          {!error && rows !== null && rows.length > 0 && (
            <table className="w-full border-collapse text-[13px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  {displayCols.map((c, i) => (
                    <th key={c} className="whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-left font-normal last:border-r-0">
                      <span className="flex items-center gap-1.5">
                        {i < fk.targetColumns.length && <KeyRound size={10} className="text-brand" />}
                        <span className="font-mono font-medium text-foreground">{c}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const selected = currentKey !== null && currentKey !== undefined && String(r[authUsers ? 'id' : fk.targetColumns[0]]) === String(currentKey)
                  return (
                    <tr
                      key={i}
                      onClick={() => {
                        const values: Record<string, unknown> = {}
                        fk.columns.forEach((src, j) => (values[src] = r[authUsers ? 'id' : fk.targetColumns[j]]))
                        onPick(values)
                        onClose()
                      }}
                      className={'cursor-pointer ' + (selected ? 'bg-brand/10' : 'hover:bg-accent/50')}
                    >
                      {displayCols.map((c) => (
                        <td key={c} className="max-w-[200px] truncate border-b border-r border-border/60 px-3 py-1.5 font-mono text-foreground/80 last:border-r-0">
                          <Cell value={r[c]} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/* ── the FK field in the row sheet: a select-only combobox trigger ──────── */

/**
 * Select-only combobox trigger for an FK field in the row sheet; shows the
 * current value (or placeholder/NULL) and opens the record picker on click.
 *
 * @param props.fk - The foreign key describing the reference.
 * @param props.value - The currently selected value shown in the trigger.
 * @param props.disabled - Whether the trigger is disabled.
 * @param props.placeholder - Placeholder text shown when no value is selected.
 * @param props.onOpen - Called when the trigger is activated to open the picker.
 */
export function FkField({
  fk,
  value,
  disabled,
  placeholder,
  onOpen,
}: {
  fk: Fk
  value: string
  disabled?: boolean
  placeholder: string
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className="flex h-8 w-full items-center gap-2 rounded-md border border-input bg-field px-2.5 text-left font-mono text-[13px] text-foreground transition-colors hover:border-muted-foreground focus:border-brand focus:outline-none disabled:pointer-events-none disabled:opacity-50"
      title={`Select a record from ${fk.target}`}
    >
      {value ? (
        <span className="truncate">{value}</span>
      ) : (
        <span className="text-muted-foreground/60">{disabled ? 'NULL' : placeholder}</span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-1 font-sans text-[11px] text-muted-foreground/80">
        {fk.target} <ArrowUpRight size={11} />
      </span>
    </button>
  )
}
