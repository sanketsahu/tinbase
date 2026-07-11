import { Copy, Download, Eye, FileCode, Files, MoreVertical, Pencil, Plus, Search, ShieldCheck, Table2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type TableInfo } from '../../api'
import {
  Button,
  Empty,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  ResizablePanel,
  toast,
} from '../../components/ui'
import { SchemaSelect } from '../../components/schema-select'
import { copyText } from '../../lib/clipboard'
import { downloadFile, toCsv } from '../../lib/export'
import { fetchTableDdl } from './definition-view'
import { DeleteTableDialog, DuplicateTableDialog, NewTableDialog, RenameTableDialog } from './table-actions'

/** Which table-action dialog is currently open, if any. */
type DialogState = { kind: 'new' } | { kind: 'rename' | 'duplicate' | 'delete'; table: string } | null

/**
 * Left sidebar showing a searchable list of tables with per-table actions and RLS status.
 *
 * @param tables - The tables to list.
 * @param active - The currently selected table name.
 * @param onSelect - Selects a table by name.
 * @param onTablesChanged - Reloads the tables after a create/rename/duplicate/delete.
 * @param onOpenPolicies - Opens the RLS policies view for a table.
 * @param refreshKey - Any changing value forces an RLS-badge refetch (e.g. when RLS is toggled elsewhere).
 * @returns The table list sidebar.
 */
export function TableList({
  tables,
  schema,
  managed,
  active,
  onSelect,
  onTablesChanged,
  onOpenPolicies,
  refreshKey,
}: {
  tables: TableInfo[]
  schema: string
  /** managed schemas are read-only in the editor: no DDL, no RLS nagging */
  managed?: boolean
  active: string | null
  onSelect: (name: string) => void
  onTablesChanged: () => Promise<void>
  onOpenPolicies: (table: string) => void
  refreshKey?: unknown
}) {
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<DialogState>(null)
  /** name → true when the relation is effectively unrestricted: a table with RLS
   *  off, or a view WITHOUT security_invoker (runs as owner, bypassing RLS). */
  const [unrestricted, setUnrestricted] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    api
      .sql(
        `select c.relname as name, c.relkind = 'v' as is_view, c.relrowsecurity as rls,
                coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as invoker
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = '${schema.replace(/'/g, "''")}' and c.relkind in ('r','v')`
      )
      .then((res) => {
        if (cancelled || !res.ok || !res.rows) return
        const map: Record<string, boolean> = {}
        for (const r of res.rows as { name: string; is_view: boolean; rls: boolean; invoker: boolean }[]) {
          map[r.name] = r.is_view ? !r.invoker : !r.rls
        }
        setUnrestricted(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tables, schema, refreshKey])

  async function copySchema(table: string) {
    try {
      const ddl = await fetchTableDdl(schema, table)
      await copyText(ddl, `${table} schema`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function exportTable(table: string, fmt: 'csv' | 'json') {
    try {
      const { rows, total } = await api.rows(table, { limit: 10000, offset: 0, schema })
      if (fmt === 'json') downloadFile(`${table}.json`, 'application/json', JSON.stringify(rows, null, 2))
      else {
        const cols = rows[0] ? Object.keys(rows[0]) : []
        downloadFile(`${table}.csv`, 'text/csv', toCsv(cols, rows))
      }
      if (total > rows.length) toast(`Exported the first ${rows.length.toLocaleString()} of ${total.toLocaleString()} rows`)
      else toast.success(`Exported ${rows.length.toLocaleString()} rows`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const filtered = tables.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <ResizablePanel id="table-editor-rail" side="left" defaultSize={240} min={200} max={420} className="flex flex-col border-r border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
        Tables <span className="text-muted-foreground/60">{tables.length}</span>
      </div>

      <div className="space-y-1.5 px-2 pb-2">
        <SchemaSelect className="w-full" />
        {!managed && (
          <Button variant="outline" size="xs" className="w-full" onClick={() => setDialog({ kind: 'new' })}>
            <Plus size={12} /> New table
          </Button>
        )}
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="h-7 w-full rounded-md border border-border bg-field pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto pb-2">
        {filtered.map((t) => {
          const unres = !managed && unrestricted[t.name] === true
          return (
            <div
              key={t.name}
              className={
                'group flex w-full items-center gap-1.5 pl-3 pr-1.5 text-left text-[13px] ' +
                (active === t.name ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')
              }
            >
              <button className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left" onClick={() => onSelect(t.name)}>
                {t.isView ? (
                  <span title="View (read-only)">
                    <Eye size={12} className="shrink-0 text-muted-foreground/60" />
                  </span>
                ) : (
                  <Table2 size={12} className="shrink-0 text-muted-foreground/50" />
                )}
                <span className="truncate font-mono">{t.name}</span>
                {unres && (
                  <span
                    className="shrink-0 rounded border border-destructive/30 bg-destructive/10 px-1 py-px text-[8px] font-semibold tracking-wider text-destructive"
                    title={
                      t.isView
                        ? 'View runs with the owner’s permissions (no security_invoker) — RLS on the underlying tables is bypassed'
                        : 'RLS is disabled — all rows are exposed to every role'
                    }
                  >
                    UNRESTRICTED
                  </span>
                )}
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground/60 group-hover:hidden">{t.rowCount}</span>

              <Menu>
                <MenuTrigger asChild>
                  <button
                    className="hidden shrink-0 rounded p-1 text-muted-foreground/80 hover:bg-muted hover:text-foreground group-hover:block data-[state=open]:block data-[state=open]:bg-muted data-[state=open]:text-foreground"
                    title="Table actions"
                  >
                    <MoreVertical size={13} />
                  </button>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuItem onSelect={() => void copyText(t.name, `"${t.name}"`)}>
                    <Copy size={13} /> Copy name
                  </MenuItem>
                  {!t.isView && (
                    <MenuItem onSelect={() => void copySchema(t.name)}>
                      <FileCode size={13} /> Copy table schema
                    </MenuItem>
                  )}
                  <MenuSeparator />
                  {!t.isView && !managed && (
                    <>
                      <MenuItem onSelect={() => setDialog({ kind: 'rename', table: t.name })}>
                        <Pencil size={13} /> Rename table
                      </MenuItem>
                      <MenuItem onSelect={() => setDialog({ kind: 'duplicate', table: t.name })}>
                        <Files size={13} /> Duplicate table
                      </MenuItem>
                      <MenuItem onSelect={() => onOpenPolicies(t.name)}>
                        <ShieldCheck size={13} /> View policies
                      </MenuItem>
                    </>
                  )}
                  <MenuSub>
                    <MenuSubTrigger>
                      <Download size={13} /> Export data
                    </MenuSubTrigger>
                    <MenuSubContent>
                      <MenuItem onSelect={() => void exportTable(t.name, 'csv')}>Export as CSV</MenuItem>
                      <MenuItem onSelect={() => void exportTable(t.name, 'json')}>Export as JSON</MenuItem>
                    </MenuSubContent>
                  </MenuSub>
                  {!t.isView && !managed && (
                    <>
                      <MenuSeparator />
                      <MenuItem danger onSelect={() => setDialog({ kind: 'delete', table: t.name })}>
                        <Trash2 size={13} /> Delete table
                      </MenuItem>
                    </>
                  )}
                </MenuContent>
              </Menu>
            </div>
          )
        })}
        {filtered.length === 0 && <Empty>{tables.length === 0 ? 'No tables yet — create one.' : 'No match.'}</Empty>}
      </div>

      {dialog?.kind === 'new' && (
        <NewTableDialog
          schema={schema}
          onClose={() => setDialog(null)}
          onDone={async (name) => {
            await onTablesChanged()
            if (name) onSelect(name)
          }}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameTableDialog
          table={dialog.table}
          schema={schema}
          onClose={() => setDialog(null)}
          onDone={async (newName) => {
            await onTablesChanged()
            onSelect(newName)
          }}
        />
      )}
      {dialog?.kind === 'duplicate' && (
        <DuplicateTableDialog
          table={dialog.table}
          schema={schema}
          onClose={() => setDialog(null)}
          onDone={async (newName) => {
            await onTablesChanged()
            onSelect(newName)
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteTableDialog table={dialog.table} schema={schema} onClose={() => setDialog(null)} onDone={onTablesChanged} />
      )}
    </ResizablePanel>
  )
}
