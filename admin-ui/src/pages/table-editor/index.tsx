import {
  AlertTriangle,
  ArrowDown,
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  Filter,
  KeyRound,
  Link2,
  Lock,
  ListFilter,
  Maximize2,
  Pencil,
  Pin,
  PinOff,
  MoreVertical,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, setRoleToken, type Column, type TableInfo } from '../../api'
import {
  Button,
  Checkbox,
  ConfirmDialog,
  CopyButton,
  Empty,
  Kbd,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  Select,
  Spinner,
  toast,
} from '../../components/ui'
import { copyText } from '../../lib/clipboard'
import { downloadFile, toCsv } from '../../lib/export'
import { navigate, useRoute } from '../../lib/router'
import { isManagedSchema, qualify, useDbSchema } from '../../lib/schema'
import { Cell, CellEditor, cellTitle, type CellAnchor } from './cells'
import { DefinitionView } from './definition-view'
import { FkPeek, ForeignKeySheet, type Fk } from './fk'
import { FilterBar } from './filter-bar'
import { buildFilterPairs, CHECK_W, coerce, defaultWidth, type FilterRule, type SortRule } from './model'
import { RenameColumnDialog } from './rename-column-dialog'
import { AddColumnDialog } from './table-actions'
import { RolePicker, type RolePreview } from '../../components/role-picker'
import { RlsControls, RlsPoliciesSheet, ViewSecurityControls } from '../../components/rls'
import { RowSheet } from './row-sheet'
import { TableList } from './table-list'

/**
 * Supabase-style table editor: a browsable, filterable, sortable data grid with
 * inline cell editing, foreign-key navigation, bulk operations, column
 * management, RLS/role preview, and a read-only SQL definition view.
 */
export function TableEditor() {
  const [schema] = useDbSchema()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [rowsBusy, setRowsBusy] = useState(false)

  const [page, setPage] = useState(0)
  const [perPage, setPerPage] = useState(100)
  const [sorts, setSorts] = useState<SortRule[]>([])
  const [filters, setFilters] = useState<FilterRule[]>([])

  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [frozen, setFrozen] = useState<Set<string>>(new Set())
  const [widths, setWidths] = useState<Record<string, number>>({})

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastIdx = useRef<number | null>(null)

  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmingBulk, setConfirmingBulk] = useState(false)
  const [droppingColumn, setDroppingColumn] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [cellEdit, setCellEdit] = useState<{ key: string; col: string; rect: CellAnchor } | null>(null)
  const [fkPeek, setFkPeek] = useState<{ fk: Fk; value: unknown; rect: CellAnchor } | null>(null)
  const [fkEdit, setFkEdit] = useState<{ row: Record<string, unknown>; fk: Fk; col: string } | null>(null)

  const [colsOpen, setColsOpen] = useState(false)
  const [view, setView] = useState<'data' | 'definition'>('data')
  const [role, setRole] = useState<RolePreview>({ kind: 'postgres' })
  const [policiesFor, setPoliciesFor] = useState<string | null>(null)
  const [rlsVersion, setRlsVersion] = useState(0)
  const bumpRls = useCallback(() => setRlsVersion((v) => v + 1), [])

  const table = tables.find((t) => t.name === active) || null
  const managed = isManagedSchema(schema)
  const canSelect = !!table && table.primaryKey.length > 0 && !table.isView && !managed

  /* enum type → ordered labels, so enum cells edit as a value picker */
  const [enums, setEnums] = useState<Record<string, string[]>>({})
  useEffect(() => {
    api
      .sql(
        `select t.typname as name, e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         order by t.typname, e.enumsortorder`
      )
      .then((res) => {
        if (!res.ok || !res.rows) return
        const map: Record<string, string[]> = {}
        for (const r of res.rows as { name: string; label: string }[]) (map[r.name] ??= []).push(r.label)
        setEnums(map)
      })
      .catch(() => {})
  }, [schema])
  const visibleCols = useMemo(() => (table ? table.columns.filter((c) => !hidden.has(c.name)) : []), [table, hidden])
  const frozenCols = useMemo(() => visibleCols.filter((c) => frozen.has(c.name)), [visibleCols, frozen])

  const widthOf = useCallback((c: Column) => widths[c.name] ?? defaultWidth(c), [widths])

  const fkOf = useCallback((col: string) => table?.foreignKeys.find((fk) => fk.columns.includes(col)), [table])

  const stickyLeft = useCallback(
    (name: string): number | null => {
      if (!frozen.has(name)) return null
      let left = CHECK_W
      for (const c of frozenCols) {
        if (c.name === name) return left
        left += widthOf(c)
      }
      return left
    },
    [frozen, frozenCols, widthOf]
  )

  /* ── data loading ── */
  // The URL (/_/table/<name>) is the source of truth for the selected table —
  // deep links (Advisor, palette, back/forward) must win over "first table".
  const route = useRoute()
  const routeSection = route.tab === 'table' ? route.section : null
  const routeSectionRef = useRef(routeSection)
  routeSectionRef.current = routeSection

  const loadTables = useCallback(async () => {
    try {
      const t = await api.tables(schema)
      setTables(t)
      setActive((cur) => {
        if (cur && t.some((x) => x.name === cur)) return cur
        const fromUrl = routeSectionRef.current
        if (fromUrl && t.some((x) => x.name === fromUrl)) return fromUrl
        return t[0]?.name ?? null
      })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [schema])

  useEffect(() => {
    // schema switch: drop the stale selection so the first table of the new
    // schema (or the deep-linked one) is picked, then reload
    setActive(null)
    setTables([])
    setLoading(true)
    loadTables().finally(() => setLoading(false))
  }, [loadTables])

  // adopt URL changes (palette jump, back/forward) once the table list knows the name
  useEffect(() => {
    if (routeSection && routeSection !== active && tables.some((t) => t.name === routeSection)) {
      setActive(routeSection)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSection, tables])

  // push the selection into the URL — but never while the URL points at a valid
  // table we have not adopted yet (that would fight the effect above and loop)
  useEffect(() => {
    if (!active || route.tab !== 'table' || route.section === active) return
    if (routeSection && tables.some((t) => t.name === routeSection)) return
    navigate('table', active, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tables])

  /* Monotonic request stamp: switching tables fires several loadRows (reset
     cascade) and an EARLIER request can resolve LAST — without this guard the
     previous table's rows would land under the new table's columns. */
  const loadSeq = useRef(0)

  const loadRows = useCallback(async () => {
    if (!active || !table) return
    const seq = ++loadSeq.current
    setRowsBusy(true)
    try {
      const order =
        sorts.length > 0
          ? sorts.map((s) => `${s.column}.${s.dir}`).join(',')
          : table.primaryKey[0]
            ? `${table.primaryKey[0]}.asc`
            : undefined
      const { rows, total } = await api.rows(active, {
        limit: perPage,
        offset: page * perPage,
        order,
        schema,
        filters: buildFilterPairs(table.columns, filters),
      })
      if (seq !== loadSeq.current) return // stale response — a newer request owns the grid
      setRows(rows)
      setTotal(total)
    } catch (e) {
      if (seq === loadSeq.current) toast.error((e as Error).message)
    } finally {
      if (seq === loadSeq.current) setRowsBusy(false)
    }
  }, [active, table, page, perPage, sorts, filters, role, rlsVersion, schema])

  useEffect(() => () => setRoleToken(null), [])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    // hard reset per table (and per schema — the same table name can exist in
    // both): the old grid must never render under the new table's columns
    setRows([])
    setTotal(0)
    setPage(0)
    setSorts([])
    setFilters([])
    setSelected(new Set())
    setHidden(new Set())
    setFrozen(new Set())
    setWidths({})
    setCellEdit(null)
    setFkPeek(null)
    setFkEdit(null)
    setEditing(null)
    lastIdx.current = null
  }, [active, schema])

  useEffect(() => {
    setPage(0)
    setSelected(new Set())
  }, [filters, perPage])

  useEffect(() => {
    if (!table) return
    const names = new Set(table.columns.map((c) => c.name))
    setSorts((cur) => (cur.some((s) => !names.has(s.column)) ? cur.filter((s) => names.has(s.column)) : cur))
    setFilters((cur) =>
      cur.some((f) => f.column !== '*' && !names.has(f.column)) ? cur.filter((f) => f.column === '*' || names.has(f.column)) : cur
    )
    setHidden((cur) => ([...cur].some((n) => !names.has(n)) ? new Set([...cur].filter((n) => names.has(n))) : cur))
    setFrozen((cur) => ([...cur].some((n) => !names.has(n)) ? new Set([...cur].filter((n) => names.has(n))) : cur))
  }, [table])

  /* ── selection ── */
  const keyOf = useCallback((row: Record<string, unknown>) => JSON.stringify(table!.primaryKey.map((k) => row[k])), [table])
  const pkOf = useCallback(
    (row: Record<string, unknown>) => {
      const pk: Record<string, unknown> = {}
      for (const k of table!.primaryKey) pk[k] = row[k]
      return pk
    },
    [table]
  )

  function toggleRow(idx: number, checked: boolean, shift: boolean) {
    setSelected((cur) => {
      const next = new Set(cur)
      const apply = (i: number) => {
        const k = keyOf(rows[i])
        if (checked) next.add(k)
        else next.delete(k)
      }
      if (shift && lastIdx.current !== null) {
        const [a, b] = [Math.min(lastIdx.current, idx), Math.max(lastIdx.current, idx)]
        for (let i = a; i <= b; i++) apply(i)
      } else {
        apply(idx)
      }
      return next
    })
    lastIdx.current = idx
  }

  const pageKeys = useMemo(() => (canSelect ? rows.map((r) => keyOf(r)) : []), [rows, keyOf, canSelect])
  const allChecked = pageKeys.length > 0 && pageKeys.every((k) => selected.has(k))
  const someChecked = pageKeys.some((k) => selected.has(k))
  const selectedRows = useMemo(
    () => (canSelect ? rows.filter((r) => selected.has(keyOf(r))) : []),
    [rows, selected, keyOf, canSelect]
  )

  /* ── bulk ops ── */
  const bulkDelete = useCallback(async () => {
    if (!table || selected.size === 0) return
    try {
      const keys = [...selected].map((k) => JSON.parse(k) as unknown[])
      if (table.primaryKey.length === 1) {
        await api.deleteRows(table.name, table.primaryKey[0], keys.map((k) => k[0]), schema)
      } else {
        for (const k of keys) {
          const pk: Record<string, unknown> = {}
          table.primaryKey.forEach((col, i) => (pk[col] = k[i]))
          await api.deleteRow(table.name, pk, schema)
        }
      }
      toast.success(`Deleted ${selected.size} row(s)`)
      setSelected(new Set())
      await loadRows()
      await loadTables()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [table, selected, loadRows, loadTables])

  function exportPage(fmt: 'json' | 'csv') {
    const cols = visibleCols.map((c) => c.name)
    if (fmt === 'json') downloadFile(`${active}-page${page + 1}.json`, 'application/json', JSON.stringify(rows, null, 2))
    else downloadFile(`${active}-page${page + 1}.csv`, 'text/csv', toCsv(cols, rows))
  }

  /* ── column ops ── */
  function toggleSort(col: string, additive: boolean) {
    setSorts((cur) => {
      const existing = cur.find((s) => s.column === col)
      const cycled: SortRule | null = !existing
        ? { column: col, dir: 'asc' }
        : existing.dir === 'asc'
          ? { column: col, dir: 'desc' }
          : null
      if (!additive) return cycled ? [cycled] : []
      const rest = cur.filter((s) => s.column !== col)
      return cycled ? [...rest, cycled] : rest
    })
  }

  /* ── inline cell editing ── */
  function startCellEdit(row: Record<string, unknown>, col: Column, el: HTMLElement) {
    if (!canSelect) return // the no-primary-key banner explains why
    if (col.isPrimaryKey) return toast('Primary key columns are locked — use the SQL editor to change keys')
    const fk = fkOf(col.name)
    if (fk) return setFkEdit({ row, fk, col: col.name })
    const r = el.getBoundingClientRect()
    setCellEdit({ key: keyOf(row), col: col.name, rect: { top: r.top, left: r.left, width: r.width, height: r.height } })
  }

  /** Applies a picked FK record (possibly multiple columns) to a row. */
  async function commitFkPick(row: Record<string, unknown>, values: Record<string, unknown>) {
    try {
      const res = await api.updateRow(active!, pkOf(row), values, schema)
      const updated = Array.isArray(res) ? (res[0] as Record<string, unknown>) : null
      setRows((rs) => rs.map((r) => (r === row ? (updated ?? { ...r, ...values }) : r)))
      toast.success('Row updated')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function commitCellEdit(row: Record<string, unknown>, c: Column, raw: string, move: -1 | 0 | 1) {
    const orig = row[c.name]
    const origStr = orig === null || orig === undefined ? '' : typeof orig === 'object' ? JSON.stringify(orig) : String(orig)
    let nextRow = row
    if (raw !== origStr) {
      const value = raw === '__null' ? null : raw === '' && c.nullable ? null : coerce(raw, c.type)
      try {
        const res = await api.updateRow(active!, pkOf(row), { [c.name]: value }, schema)
        const updated = Array.isArray(res) ? (res[0] as Record<string, unknown>) : null
        nextRow = updated ?? { ...row, [c.name]: value }
        setRows((rs) => rs.map((r) => (r === row ? nextRow : r)))
        toast.success('Row updated')
      } catch (e) {
        toast.error((e as Error).message)
        setCellEdit(null)
        return
      }
    }
    if (move !== 0 && cellEdit) {
      const idx = visibleCols.findIndex((x) => x.name === c.name)
      let step = move
      let next = visibleCols[idx + step]
      let left = cellEdit.rect.left
      let prev: Column = c
      while (next && (next.isPrimaryKey || fkOf(next.name))) {
        left += move === 1 ? widthOf(prev) : -widthOf(next)
        prev = next
        step += move
        next = visibleCols[idx + step]
      }
      if (next) {
        left += move === 1 ? widthOf(prev) : -widthOf(next)
        return setCellEdit({ key: keyOf(nextRow), col: next.name, rect: { ...cellEdit.rect, left, width: widthOf(next) } })
      }
    }
    setCellEdit(null)
  }

  async function dropColumn(col: string) {
    if (!active) return
    const res = await api.sql(`alter table ${qualify(schema, active)} drop column "${col}"`)
    if (!res.ok) return toast.error(res.error ?? 'Failed to drop column')
    toast.success(`Dropped column ${col}`)
    await loadTables()
  }

  /* ── keyboard: cell focus navigation + shortcuts ── */
  // focus is (row index, visible-column index); reset whenever the data under it changes
  const [focusedCell, setFocusedCell] = useState<{ r: number; c: number } | null>(null)
  useEffect(() => setFocusedCell(null), [active, page, rows.length, visibleCols.length])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (editing || creating || renaming || cellEdit || t.closest('input, textarea, select, [role="dialog"]')) return

      /* spreadsheet-style navigation over the focused cell */
      if (focusedCell && canSelect) {
        const move = (dr: number, dc: number) => {
          e.preventDefault()
          const r = Math.max(0, Math.min(rows.length - 1, focusedCell.r + dr))
          const c = Math.max(0, Math.min(visibleCols.length - 1, focusedCell.c + dc))
          setFocusedCell({ r, c })
          document
            .querySelector(`[data-cell="${r}:${visibleCols[c]?.name}"]`)
            ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        }
        if (e.key === 'ArrowUp') return move(-1, 0)
        if (e.key === 'ArrowDown') return move(1, 0)
        if (e.key === 'ArrowLeft') return move(0, -1)
        if (e.key === 'ArrowRight') return move(0, 1)
        const row = rows[focusedCell.r]
        const col = visibleCols[focusedCell.c]
        if (row && col && e.key === 'Enter') {
          e.preventDefault()
          const el = document.querySelector(`[data-cell="${focusedCell.r}:${col.name}"]`) as HTMLElement | null
          if (el) startCellEdit(row, col, el)
          return
        }
        if (row && col && (e.key === 'Delete' || e.key === 'Backspace')) {
          if (!col.isPrimaryKey && !fkOf(col.name) && col.nullable && row[col.name] !== null) {
            e.preventDefault()
            void commitCellEdit(row, col, '', 0)
            return
          }
        }
        if (e.key === 'Escape') {
          setFocusedCell(null)
          return
        }
      }

      if (e.key === 'Escape') setSelected(new Set())
      if (e.key === 'Delete' && selected.size > 0) setConfirmingBulk(true)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, editing, creating, renaming, cellEdit, focusedCell, rows, visibleCols, canSelect])

  /* ── column resize ── */
  const resize = useRef<{ col: string; startX: number; startW: number } | null>(null)
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const r = resize.current
      if (!r) return
      setWidths((w) => ({ ...w, [r.col]: Math.max(72, r.startW + (e.clientX - r.startX)) }))
    }
    const up = () => (resize.current = null)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  if (loading) return <Spinner />

  const pages = Math.max(1, Math.ceil(total / perPage))
  const gridWidth = CHECK_W + visibleCols.reduce((s, c) => s + widthOf(c), 0) + 40

  return (
    <div className="flex h-full">
      <TableList
        tables={tables}
        schema={schema}
        managed={managed}
        active={active}
        onSelect={setActive}
        onTablesChanged={loadTables}
        onOpenPolicies={setPoliciesFor}
        refreshKey={rlsVersion}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {table ? (
          <>
            {view === 'definition' ? (
              <DefinitionView table={table.name} schema={schema} refreshKey={table} />
            ) : (
              <>
            {selected.size > 0 ? (
              <div className="flex h-11.5 shrink-0 items-center gap-3 border-b border-border bg-brand/10 px-3">
                <Checkbox
                  checked={allChecked}
                  indeterminate={!allChecked && someChecked}
                  onChange={(c) => setSelected(c ? new Set(pageKeys) : new Set())}
                />
                <span className="text-[13px] text-foreground">
                  <span className="font-semibold text-brand">{selected.size}</span> row{selected.size === 1 ? '' : 's'} selected
                </span>
                <div className="mx-1 h-4 w-px bg-muted" />
                <CopyButton
                  variant="outline"
                  size="xs"
                  label="rows as JSON"
                  value={() => JSON.stringify(selectedRows, null, 2)}
                >
                  Copy JSON
                </CopyButton>
                <CopyButton
                  variant="outline"
                  size="xs"
                  label="rows as CSV"
                  value={() => toCsv(visibleCols.map((c) => c.name), selectedRows)}
                >
                  Copy CSV
                </CopyButton>
                <Button variant="dangerSolid" size="xs" onClick={() => setConfirmingBulk(true)}>
                  <Trash2 size={12} /> Delete {selected.size}
                </Button>
                <span className="ml-1 hidden items-center gap-1 text-[11px] text-muted-foreground/80 lg:flex">
                  <Kbd>Del</Kbd> delete · <Kbd>Esc</Kbd> clear
                </span>
                <button className="ml-auto p-1 text-muted-foreground/80 hover:text-foreground" onClick={() => setSelected(new Set())}>
                  <X size={15} />
                </button>
              </div>
            ) : (
              <div className="flex h-11.5 shrink-0 items-center gap-2 border-b border-border px-3">
                <FilterBar columns={table.columns} filters={filters} onChange={setFilters} />

                <div className="ml-auto flex items-center gap-1.5">
                  {/* RLS lives on tables; views get the security_invoker control; managed schemas are grant-controlled */}
                  {!managed &&
                    (table.isView ? (
                      <ViewSecurityControls key={table.name} view={table.name} schema={schema} refreshKey={rlsVersion} onChanged={bumpRls} />
                    ) : (
                      <RlsControls key={table.name} table={table.name} schema={schema} refreshKey={rlsVersion} onChanged={bumpRls} />
                    ))}
                  <RolePicker
                    value={role}
                    onChange={(r, token) => {
                      setRoleToken(token)
                      setRole(r)
                      setSelected(new Set())
                    }}
                  />
                  <Popover
                    open={colsOpen}
                    onOpenChange={setColsOpen}
                    align="end"
                    className="w-60 p-1.5"
                    trigger={
                      <Button variant="outline" size="iconXs" title="View options" onClick={() => setColsOpen((o) => !o)}>
                        <MoreVertical size={13} />
                      </Button>
                    }
                  >
                    <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                      Columns{hidden.size > 0 ? ` — ${hidden.size} hidden` : ''}
                    </p>
                    <div className="max-h-56 overflow-auto">
                      {table.columns.map((c) => (
                        <label
                          key={c.name}
                          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-accent"
                        >
                          <Checkbox
                            checked={!hidden.has(c.name)}
                            onChange={(on) =>
                              setHidden((cur) => {
                                const next = new Set(cur)
                                if (on) next.delete(c.name)
                                else next.add(c.name)
                                return next
                              })
                            }
                          />
                          <span className="truncate font-mono">{c.name}</span>
                          <span className="ml-auto text-[11px] text-muted-foreground/60">{c.type}</span>
                        </label>
                      ))}
                    </div>
                    {hidden.size > 0 && (
                      <button
                        className="w-full rounded px-2 py-1.5 text-left text-xs text-brand hover:bg-accent"
                        onClick={() => setHidden(new Set())}
                      >
                        Show all columns
                      </button>
                    )}
                    <div className="my-1 h-px bg-accent" />
                    <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Export page</p>
                    {(['csv', 'json'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] text-foreground hover:bg-accent"
                        onClick={() => {
                          exportPage(fmt)
                          setColsOpen(false)
                        }}
                      >
                        <Download size={13} className="text-muted-foreground/80" /> Export as {fmt.toUpperCase()}
                      </button>
                    ))}
                  </Popover>
                  <Button variant="ghost" size="iconXs" title="Refresh" onClick={() => void loadRows()}>
                    <RefreshCw size={13} className={rowsBusy ? 'animate-spin' : ''} />
                  </Button>
                  {!table.isView && !managed && (
                    <Button size="xs" onClick={() => setCreating(true)}>
                      <Plus size={13} /> Insert
                    </Button>
                  )}
                </div>
              </div>
            )}

            {!canSelect &&
              (managed ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <Lock size={13} className="shrink-0" />
                  <span>
                    The <span className="font-mono text-foreground/80">{schema}</span> schema is managed by tinbase — read-only
                    here; change it through SQL. It isn't exposed to anon/authenticated through the Data API, so access is
                    controlled by grants rather than RLS.
                  </span>
                </div>
              ) : table?.isView ? (
                <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/40 px-3 py-1.5 text-xs text-muted-foreground">
                  <Eye size={13} className="shrink-0" />
                  <span>This is a view — computed from other tables, so it's read-only. Edit the underlying tables instead.</span>
                </div>
              ) : (
                <div className="flex shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>
                    This table has no primary key, so rows can't be uniquely addressed — selection and editing are off. Inserting
                    still works; add a primary key (SQL editor) to unlock everything.
                  </span>
                </div>
              ))}

            <div className={'min-h-0 flex-1 overflow-auto transition-opacity ' + (rowsBusy ? 'opacity-60' : '')}>
              <table className="border-collapse text-[13px]" style={{ width: Math.max(gridWidth, 0), tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: CHECK_W }} />
                  {visibleCols.map((c) => (
                    <col key={c.name} style={{ width: widthOf(c) }} />
                  ))}
                  <col style={{ width: 40 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="sticky left-0 top-0 z-30 border-b border-r border-border bg-card px-0">
                      <div className="flex h-8.5 items-center gap-1.5 pl-3">
                        <Checkbox
                          checked={allChecked}
                          indeterminate={!allChecked && someChecked}
                          disabled={!canSelect}
                          title={canSelect ? undefined : 'Table has no primary key'}
                          onChange={(c) => setSelected(c ? new Set(pageKeys) : new Set())}
                        />
                      </div>
                    </th>
                    {visibleCols.map((c) => {
                      const sortIdx = sorts.findIndex((s) => s.column === c.name)
                      const sort = sortIdx >= 0 ? sorts[sortIdx] : null
                      const left = stickyLeft(c.name)
                      const fk = fkOf(c.name)
                      return (
                        <th
                          key={c.name}
                          className="group/th relative border-b border-r border-border bg-card p-0 text-left font-normal"
                          style={left !== null ? { position: 'sticky', left, top: 0, zIndex: 25 } : { position: 'sticky', top: 0, zIndex: 20 }}
                        >
                          <div className="flex h-8.5 items-center gap-1.5 pl-3 pr-1">
                            {c.isPrimaryKey && <KeyRound size={11} className="shrink-0 text-warning" />}
                            {fk && (
                              <span title={`foreign key → ${fk.target}.${fk.targetColumns.join(',')}`}>
                                <Link2 size={11} className="shrink-0 text-info" />
                              </span>
                            )}
                            <button
                              className="min-w-0 truncate font-mono font-medium text-foreground hover:text-primary-foreground"
                              title={`${c.name} — click to sort${fk ? ` · fk → ${fk.target}` : ''}`}
                              onClick={(e) => toggleSort(c.name, e.shiftKey)}
                            >
                              {c.name}
                            </button>
                            <span className="shrink-0 text-[11px] text-muted-foreground/60">{c.type}</span>
                            {sort && (
                              <span className="flex shrink-0 items-center text-brand">
                                {sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                                {sorts.length > 1 && <span className="text-[10px]">{sortIdx + 1}</span>}
                              </span>
                            )}

                            <Menu>
                              <MenuTrigger asChild>
                                <button className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground focus:opacity-100 group-hover/th:opacity-100 data-[state=open]:opacity-100">
                                  <ChevronDown size={13} />
                                </button>
                              </MenuTrigger>
                              <MenuContent>
                                <MenuItem onSelect={() => setSorts([{ column: c.name, dir: 'asc' }])}>
                                  <ArrowUp size={13} /> Sort ascending
                                </MenuItem>
                                <MenuItem onSelect={() => setSorts([{ column: c.name, dir: 'desc' }])}>
                                  <ArrowDown size={13} /> Sort descending
                                </MenuItem>
                                <MenuItem onSelect={() => setSorts((cur) => cur.filter((s) => s.column !== c.name))} disabled={!sort}>
                                  <ArrowDownUp size={13} /> Clear sort
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem onSelect={() => void copyText(c.name, `"${c.name}"`)}>
                                  <Copy size={13} /> Copy name
                                </MenuItem>
                                <MenuItem
                                  onSelect={() =>
                                    setFrozen((cur) => {
                                      const next = new Set(cur)
                                      if (next.has(c.name)) next.delete(c.name)
                                      else next.add(c.name)
                                      return next
                                    })
                                  }
                                >
                                  {frozen.has(c.name) ? <PinOff size={13} /> : <Pin size={13} />}
                                  {frozen.has(c.name) ? 'Unfreeze column' : 'Freeze column'}
                                </MenuItem>
                                <MenuItem onSelect={() => setHidden((cur) => new Set(cur).add(c.name))}>
                                  <EyeOff size={13} /> Hide column
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem onSelect={() => setRenaming(c.name)}>
                                  <Pencil size={13} /> Rename column
                                </MenuItem>
                                <MenuItem danger onSelect={() => setDroppingColumn(c.name)}>
                                  <Trash2 size={13} /> Delete column
                                </MenuItem>
                              </MenuContent>
                            </Menu>
                          </div>
                          <div
                            className="absolute -right-0.5 top-0 z-10 h-full w-1.25 cursor-col-resize hover:bg-brand/50"
                            onMouseDown={(e) => {
                              e.preventDefault()
                              resize.current = { col: c.name, startX: e.clientX, startW: widthOf(c) }
                            }}
                          />
                        </th>
                      )
                    })}
                    {/* add-column header */}
                    <th className="sticky top-0 z-20 border-b border-border bg-card p-0">
                      <button
                        title="Add column"
                        onClick={() => setAddingColumn(true)}
                        className="flex h-8.5 w-10 items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground"
                      >
                        <Plus size={13} />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const key = canSelect ? keyOf(row) : String(i)
                    const isSel = canSelect && selected.has(key)
                    const cellBg = isSel ? 'bg-selected' : 'bg-background group-hover:bg-popover'
                    // React key is table-scoped + positional: pk-derived keys
                    // collapse to duplicates when stale rows meet a new table's
                    // pk, and duplicate keys corrupt reconciliation
                    return (
                      <tr key={`${active}:${i}`} className="group">
                        <td className={'sticky left-0 z-10 border-b border-r border-border/70 px-0 ' + cellBg}>
                          <div className="flex h-8.5 items-center gap-1.5 pl-3">
                            <Checkbox checked={isSel} disabled={!canSelect} onChange={(c, e) => toggleRow(i, c, e.shiftKey)} />
                            <button
                              title={canSelect ? 'Edit row' : 'View row'}
                              className="rounded p-0.5 text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                              onClick={() => setEditing(row)}
                            >
                              <Maximize2 size={11} />
                            </button>
                          </div>
                        </td>
                        {visibleCols.map((c, ci) => {
                          const left = stickyLeft(c.name)
                          const isEditing = canSelect && cellEdit?.key === key && cellEdit.col === c.name
                          const isFocused = focusedCell?.r === i && focusedCell.c === ci
                          const fkc = fkOf(c.name)
                          const hasValue = row[c.name] !== null && row[c.name] !== undefined
                          return (
                            <td
                              key={c.name}
                              data-cell={`${i}:${c.name}`}
                              className={
                                'relative h-8.5 truncate border-b border-r border-border/70 px-3 font-mono text-foreground/80 ' +
                                (c.isPrimaryKey ? 'cursor-default ' : 'cursor-cell ') +
                                (isFocused ? 'ring-1 ring-inset ring-brand ' : '') +
                                cellBg
                              }
                              style={left !== null ? { position: 'sticky', left, zIndex: 5 } : undefined}
                              title={isEditing ? undefined : cellTitle(row[c.name])}
                              onClick={() => canSelect && setFocusedCell({ r: i, c: ci })}
                              onDoubleClick={(e) => !isEditing && startCellEdit(row, c, e.currentTarget)}
                            >
                              <Cell value={row[c.name]} />
                              {fkc && hasValue && (
                                <button
                                  title="View referencing record"
                                  className="absolute right-1 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded border border-input bg-accent text-muted-foreground opacity-0 transition-opacity hover:border-foreground hover:text-foreground group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    const r = (e.currentTarget.closest('td') as HTMLElement).getBoundingClientRect()
                                    setFkPeek({ fk: fkc, value: row[c.name], rect: { top: r.top, left: r.left, width: r.width, height: r.height } })
                                  }}
                                  onDoubleClick={(e) => e.stopPropagation()}
                                >
                                  <ArrowRight size={11} />
                                </button>
                              )}
                              {isEditing && (
                                <CellEditor
                                  col={c}
                                  value={row[c.name]}
                                  anchor={cellEdit!.rect}
                                  enumValues={enums[c.type]}
                                  onCancel={() => setCellEdit(null)}
                                  onCommit={(raw, move) => void commitCellEdit(row, c, raw, move)}
                                />
                              )}
                            </td>
                          )
                        })}
                        <td className={'border-b border-border/70 ' + cellBg} />
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {rows.length === 0 && !rowsBusy && (
                <div className="flex flex-col items-center gap-3 py-20 text-[13px] text-muted-foreground/80">
                  {filters.length > 0 ? (
                    <>
                      <Filter size={20} className="text-muted-foreground/40" />
                      No rows match the current filters.
                      <Button variant="outline" size="xs" onClick={() => setFilters([])}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    <>
                      <ListFilter size={20} className="text-muted-foreground/40" />
                      {table.isView ? 'This view returns no rows.' : 'This table is empty.'}
                      {!table.isView && !managed && (
                        <Button size="xs" onClick={() => setCreating(true)}>
                          <Plus size={13} /> Insert your first row
                        </Button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

              </>
            )}

            <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-3 py-1.5 text-xs text-muted-foreground/80">
              {view === 'data' && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="iconXs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft size={13} />
                </Button>
                <span>Page</span>
                <input
                  key={page}
                  type="number"
                  min={1}
                  max={pages}
                  defaultValue={page + 1}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const v = parseInt((e.target as HTMLInputElement).value, 10)
                    if (!Number.isNaN(v)) setPage(Math.min(Math.max(v - 1, 0), pages - 1))
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10)
                    if (!Number.isNaN(v)) setPage(Math.min(Math.max(v - 1, 0), pages - 1))
                  }}
                  className="h-6 w-12 rounded border border-input bg-field px-1.5 text-center text-xs text-foreground focus:border-brand focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>of {pages}</span>
                <Button variant="ghost" size="iconXs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronRight size={13} />
                </Button>
              </div>
              )}
              {view === 'data' && (
              <div className="w-27.5 shrink-0">
                <Select
                  value={String(perPage)}
                  onValueChange={(v) => setPerPage(parseInt(v, 10))}
                  options={[25, 50, 100, 500].map((n) => ({ value: String(n), label: `${n} rows` }))}
                />
              </div>
              )}
              <span className="ml-auto">
                {view === 'data' && (
                  <>
                    {total.toLocaleString()} record{total === 1 ? '' : 's'}
                    {selected.size > 0 && (
                      <>
                        {' · '}
                        <span className="text-brand">{selected.size} selected</span>
                      </>
                    )}
                  </>
                )}
              </span>
              <div className="flex overflow-hidden rounded-md border border-input">
                {(['data', 'definition'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={
                      'px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ' +
                      (view === v ? 'bg-muted text-foreground' : 'text-muted-foreground/80 hover:text-foreground')
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <Empty>Select a table.</Empty>
        )}
      </div>

      {/* ── sheets & modals ── */}
      {editing && table && (
        <RowSheet
          table={table}
          tables={tables}
          initial={editing}
          readOnly={!canSelect}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api.updateRow(active!, pkOf(editing), patch, schema)
            toast.success('Row updated')
            setEditing(null)
            await loadRows()
          }}
          onDelete={async () => {
            await api.deleteRow(active!, pkOf(editing), schema)
            toast.success('Row deleted')
            setEditing(null)
            await loadRows()
            await loadTables()
          }}
        />
      )}
      {creating && table && (
        <RowSheet
          table={table}
          tables={tables}
          initial={{}}
          isNew
          onClose={() => setCreating(false)}
          onSave={async (row) => {
            await api.insertRow(active!, row, schema)
            toast.success('Row inserted')
            setCreating(false)
            await loadRows()
            await loadTables()
          }}
        />
      )}
      {policiesFor && <RlsPoliciesSheet table={policiesFor} schema={schema} onClose={() => setPoliciesFor(null)} onChanged={bumpRls} />}
      {fkPeek && (
        <FkPeek
          fk={fkPeek.fk}
          value={fkPeek.value}
          anchor={fkPeek.rect}
          tables={tables}
          onClose={() => setFkPeek(null)}
          onOpenTable={(name) => {
            setFkPeek(null)
            setActive(name)
          }}
        />
      )}
      {fkEdit && (
        <ForeignKeySheet
          fk={fkEdit.fk}
          tables={tables}
          currentKey={fkEdit.row[fkEdit.col]}
          onClose={() => setFkEdit(null)}
          onPick={(values) => {
            void commitFkPick(fkEdit.row, values)
            setFkEdit(null)
          }}
        />
      )}
      {renaming && active && (
        <RenameColumnDialog
          table={active}
          schema={schema}
          column={renaming}
          onClose={() => setRenaming(null)}
          onDone={async () => {
            setRenaming(null)
            await loadTables()
          }}
        />
      )}
      {addingColumn && active && (
        <AddColumnDialog
          table={active}
          schema={schema}
          onClose={() => setAddingColumn(false)}
          onDone={async () => {
            await loadTables()
          }}
        />
      )}
      {confirmingBulk && table && (
        <ConfirmDialog
          open
          danger
          title={`Delete ${selected.size} selected row${selected.size === 1 ? '' : 's'}?`}
          description={`Rows will be permanently deleted from "${table.name}". This cannot be undone.`}
          confirmLabel={`Delete ${selected.size} row${selected.size === 1 ? '' : 's'}`}
          onConfirm={() => void bulkDelete()}
          onClose={() => setConfirmingBulk(false)}
        />
      )}
      {droppingColumn && active && (
        <ConfirmDialog
          open
          danger
          title={`Drop column "${droppingColumn}"?`}
          description={`The column and all data in it will be permanently removed from "${active}".`}
          confirmLabel="Drop column"
          onConfirm={() => void dropColumn(droppingColumn)}
          onClose={() => setDroppingColumn(null)}
        />
      )}
    </div>
  )
}
