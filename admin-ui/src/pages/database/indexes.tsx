import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import {
  Button,
  CodeView,
  ConfirmDialog,
  Empty,
  Label,
  Select,
  Sheet,
  SheetClose,
  Spinner,
  Table,
  Td,
  Th,
  THead,
  toast,
  TRow,
} from '../../components/ui'
import { CatalogHeader, quoteIdent, quoteLit, useDbSchema } from './shared'

interface Index {
  name: string
  table: string
  def: string
  constraint: boolean
}

/** Indexes in the selected schema: browse definitions, create, drop (non-constraint only). */
export function IndexesSection() {
  const [schema] = useDbSchema()
  const [rows, setRows] = useState<Index[] | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<Index | null>(null)

  const load = useCallback(async () => {
    const res = await api.sql(
      `select i.indexname as name, i.tablename as "table", i.indexdef as def,
              exists (select 1 from pg_constraint c where c.conname = i.indexname) as constraint
       from pg_indexes i where i.schemaname = ${quoteLit(schema)} order by i.tablename, i.indexname`
    )
    setRows(res.ok ? ((res.rows ?? []) as Index[]) : [])
  }, [schema])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync with SQL-editor DDL
    return () => clearInterval(t)
  }, [load])

  async function drop(ix: Index) {
    const res = await api.sql(`drop index ${quoteIdent(schema)}.${quoteIdent(ix.name)}`)
    if (!res.ok) {
      toast.error(res.error ?? 'Drop failed')
      return
    }
    toast.success(`Dropped index ${ix.name}`)
    await load()
  }

  if (rows === null) return <Spinner />
  const visible = rows.filter((r) => (r.name + r.table).toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Indexes"
        description="Every index in the selected schema, including constraint-backed ones (locked)."
        search={search}
        onSearch={setSearch}
        onRefresh={() => void load()}
        schemaPicker
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New index
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Table</Th>
              <Th>Definition</Th>
              <Th className="w-12" />
            </tr>
          </THead>
          <tbody>
            {visible.map((r) => (
              <TRow key={r.name}>
                <Td className="font-mono text-foreground/90">{r.name}</Td>
                <Td className="font-mono text-muted-foreground">{r.table}</Td>
                <Td className="max-w-120 truncate font-mono text-[11px]" title={r.def}>
                  <span className="text-muted-foreground/80">{r.def}</span>
                </Td>
                <Td>
                  {!r.constraint && (
                    <button
                      className="p-1 text-muted-foreground/80 opacity-0 hover:text-destructive group-hover:opacity-100"
                      title="Drop index"
                      onClick={() => setDropping(r)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {visible.length === 0 && <Empty>{rows.length === 0 ? 'No indexes.' : 'No match.'}</Empty>}
      </div>

      {creating && (
        <CreateIndexSheet
          schema={schema}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}
      {dropping && (
        <ConfirmDialog
          open
          danger
          title={`Drop index "${dropping.name}"?`}
          description="Queries relying on it may slow down. This cannot be undone."
          confirmLabel="Drop index"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

const INDEX_TYPES = ['btree', 'hash', 'gin', 'gist', 'brin'] as const

/**
 * Supabase-style index builder in a side sheet: pick a table, its columns
 * (order matters), and an index type — with a live SQL preview.
 */
function CreateIndexSheet({ schema, onClose, onDone }: { schema: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [tables, setTables] = useState<{ name: string; columns: string[] }[]>([])
  const [table, setTable] = useState('')
  const [cols, setCols] = useState<string[]>([])
  const [type, setType] = useState<string>('btree')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.tables(schema).then(
      (ts) => {
        const list = ts.filter((t) => !t.isView).map((t) => ({ name: t.name, columns: t.columns.map((c) => c.name) }))
        setTables(list)
        setTable((cur) => cur || (list[0]?.name ?? ''))
      },
      () => {}
    )
  }, [schema])

  const tableCols = tables.find((t) => t.name === table)?.columns ?? []
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const sql =
    table && cols.length > 0
      ? `create index on ${q(schema)}.${q(table)} using ${type} (${cols.map(q).join(', ')});`
      : '-- pick a table and at least one column'

  function toggleCol(c: string) {
    setCols((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))
  }

  async function create() {
    setBusy(true)
    setErr('')
    const res = await api.sql(sql)
    if (!res.ok) {
      setErr(res.error ?? 'Create failed')
      setBusy(false)
      return
    }
    toast.success(`Index created on ${table}`)
    await onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-140"
      title="Create new index"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy || !table || cols.length === 0}>
              {busy ? 'Creating…' : 'Create index'}
            </Button>
          </div>
        </>
      }
    >
    <div className="space-y-3">
      <div>
        <Label>Schema</Label>
        <div className="flex h-8 items-center rounded-md border border-border bg-card px-2.5 font-mono text-[13px] text-muted-foreground">
          {schema}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Table</Label>
          <Select
            mono
            value={table}
            onValueChange={(t) => {
              setTable(t)
              setCols([])
            }}
            placeholder="Pick a table…"
            options={tables.map((t) => ({ value: t.name }))}
          />
        </div>
        <div>
          <Label>Index type</Label>
          <Select mono value={type} onValueChange={setType} options={INDEX_TYPES.map((t) => ({ value: t }))} />
        </div>
      </div>
      <div>
        <Label>Columns — click to add; order matters for btree</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border border-input bg-field p-2">
          {tableCols.map((c) => {
            const idx = cols.indexOf(c)
            return (
              <button
                key={c}
                onClick={() => toggleCol(c)}
                className={
                  'flex items-center gap-1 rounded border px-2 py-1 font-mono text-xs transition-colors ' +
                  (idx >= 0
                    ? 'border-brand/50 bg-brand/15 text-brand'
                    : 'border-input text-muted-foreground hover:border-muted-foreground hover:text-foreground')
                }
              >
                {idx >= 0 && <span className="tabular-nums">{idx + 1}.</span>}
                {c}
              </button>
            )
          })}
          {tableCols.length === 0 && <span className="px-1 py-0.5 text-xs text-muted-foreground/60">No table selected.</span>}
        </div>
      </div>
      <div>
        <Label>Preview of SQL statement</Label>
        <CodeView value={sql} lang="sql" readOnly minLines={2} maxLines={6} />
      </div>
    </div>
    </Sheet>
  )
}
