import { Pause, Play, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Empty,
  Input,
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
import { qualify } from '../../lib/schema'
import { CatalogHeader, quoteIdent, quoteLit, useDbSchema } from './shared'

interface Trigger {
  name: string
  table: string
  timing: string
  events: string[]
  function: string
  enabled: boolean
}

/** Table triggers: browse, enable/disable, drop. */
export function TriggersSection() {
  const [schema] = useDbSchema()
  const [rows, setRows] = useState<Trigger[] | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<Trigger | null>(null)

  const load = useCallback(async () => {
    const res = await api.sql(
      `select tg.tgname as name, c.relname as "table", tg.tgenabled <> 'D' as enabled,
              case when (tg.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as timing,
              array_remove(array[
                case when (tg.tgtype & 4) <> 0 then 'INSERT' end,
                case when (tg.tgtype & 8) <> 0 then 'DELETE' end,
                case when (tg.tgtype & 16) <> 0 then 'UPDATE' end], null) as events,
              p.proname as function
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = tg.tgfoid
       where n.nspname = ${quoteLit(schema)} and not tg.tgisinternal
       order by c.relname, tg.tgname`
    )
    setRows(res.ok ? ((res.rows ?? []) as Trigger[]) : [])
  }, [schema])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync with SQL-editor DDL
    return () => clearInterval(t)
  }, [load])

  async function toggle(t: Trigger) {
    const res = await api.sql(
      `alter table ${quoteIdent(schema)}.${quoteIdent(t.table)} ${t.enabled ? 'disable' : 'enable'} trigger ${quoteIdent(t.name)}`
    )
    if (!res.ok) {
      toast.error(res.error ?? 'Failed')
      return
    }
    toast.success(`${t.enabled ? 'Disabled' : 'Enabled'} ${t.name}`)
    await load()
  }

  async function drop(t: Trigger) {
    const res = await api.sql(`drop trigger ${quoteIdent(t.name)} on ${quoteIdent(schema)}.${quoteIdent(t.table)}`)
    if (!res.ok) {
      toast.error(res.error ?? 'Drop failed')
      return
    }
    toast.success(`Dropped trigger ${t.name}`)
    await load()
  }

  if (rows === null) return <Spinner />
  const visible = rows.filter((t) => (t.name + t.table).toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Triggers"
        description="Functions that fire automatically on table events."
        search={search}
        onSearch={setSearch}
        onRefresh={() => void load()}
        schemaPicker
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New trigger
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Table</Th>
              <Th>Fires</Th>
              <Th>Function</Th>
              <Th>Status</Th>
              <Th className="w-20" />
            </tr>
          </THead>
          <tbody>
            {visible.map((t) => (
              <TRow key={t.table + t.name}>
                <Td className="font-mono text-foreground/90">{t.name}</Td>
                <Td className="font-mono text-muted-foreground">{t.table}</Td>
                <Td className="text-muted-foreground">
                  {t.timing} {(t.events ?? []).join(' | ')}
                </Td>
                <Td className="font-mono text-[11px] text-muted-foreground/80">{t.function}()</Td>
                <Td>{t.enabled ? <Badge variant="brand">enabled</Badge> : <Badge variant="neutral">disabled</Badge>}</Td>
                <Td>
                  <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      className="p-1 text-muted-foreground/80 hover:text-foreground"
                      title={t.enabled ? 'Disable' : 'Enable'}
                      onClick={() => void toggle(t)}
                    >
                      {t.enabled ? <Pause size={13} /> : <Play size={13} />}
                    </button>
                    <button className="p-1 text-muted-foreground/80 hover:text-destructive" title="Drop" onClick={() => setDropping(t)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {visible.length === 0 && <Empty>{rows.length === 0 ? 'No triggers.' : 'No match.'}</Empty>}
      </div>

      {creating && (
        <CreateTriggerSheet
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
          title={`Drop trigger "${dropping.name}"?`}
          description={`The trigger on "${dropping.table}" will stop firing immediately.`}
          confirmLabel="Drop trigger"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

/**
 * Supabase-style trigger builder in a side sheet: table, events, timing,
 * orientation, and a trigger-returning function — composed into CREATE TRIGGER.
 */
function CreateTriggerSheet({ schema, onClose, onDone }: { schema: string; onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [table, setTable] = useState('')
  const [tables, setTables] = useState<string[]>([])
  const [events, setEvents] = useState<Set<string>>(new Set(['INSERT']))
  const [timing, setTiming] = useState<'BEFORE' | 'AFTER'>('AFTER')
  const [orientation, setOrientation] = useState<'ROW' | 'STATEMENT'>('ROW')
  const [fn, setFn] = useState('')
  const [fns, setFns] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.tables(schema).then(
      (ts) => {
        const names = ts.filter((t) => !t.isView).map((t) => t.name)
        setTables(names)
        setTable((cur) => cur || (names[0] ?? ''))
      },
      () => {}
    )
    api.functions(schema).then(
      (fs) => setFns((fs as { name: string; returns: string }[]).filter((f) => f.returns === 'trigger').map((f) => f.name)),
      () => {}
    )
  }, [schema])

  function toggleEvent(e: string) {
    setEvents((cur) => {
      const next = new Set(cur)
      if (next.has(e)) next.delete(e)
      else next.add(e)
      return next
    })
  }

  const eventList = ['INSERT', 'UPDATE', 'DELETE'].filter((e) => events.has(e))

  async function create() {
    if (!name.trim() || !table || eventList.length === 0 || !fn) {
      return setErr('Name, table, at least one event, and a function are required.')
    }
    setBusy(true)
    setErr('')
    const sql = `create trigger ${quoteIdent(name.trim())}
  ${timing.toLowerCase()} ${eventList.join(' or ')} on ${qualify(schema, table)}
  for each ${orientation.toLowerCase()}
  execute function ${qualify(schema, fn)}()`
    const res = await api.sql(sql)
    if (!res.ok) {
      setErr(res.error ?? 'Create failed')
      setBusy(false)
      return
    }
    toast.success(`Created trigger ${name.trim()}`)
    await onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-140"
      title="Create a new database trigger"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy || !name.trim() || !table || eventList.length === 0 || !fn}>
              {busy ? 'Creating…' : 'Create trigger'}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Name of trigger</Label>
          <Input mono value={name} autoFocus placeholder="set_updated_at" onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))} />
          <p className="mt-1 text-[11px] text-muted-foreground/60">Do not use spaces/whitespace.</p>
        </div>
        <div>
          <Label>Table</Label>
          <Select
            mono
            value={table}
            onValueChange={setTable}
            placeholder="Pick a table…"
            options={tables.map((t) => ({ value: t, label: `${schema}.${t}` }))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground/60">The trigger watches for changes on this table.</p>
        </div>
        <div>
          <Label>Events</Label>
          <div className="space-y-1.5">
            {(['INSERT', 'UPDATE', 'DELETE'] as const).map((e) => (
              <label key={e} className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/85">
                <Checkbox checked={events.has(e)} onChange={() => toggleEvent(e)} />
                <span className="font-mono">{e}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Trigger type</Label>
            <Select
              value={timing}
              onValueChange={(v) => setTiming(v as typeof timing)}
              options={[
                { value: 'BEFORE', label: 'Before the event' },
                { value: 'AFTER', label: 'After the event' },
              ]}
            />
          </div>
          <div>
            <Label>Orientation</Label>
            <Select
              value={orientation}
              onValueChange={(v) => setOrientation(v as typeof orientation)}
              options={[
                { value: 'ROW', label: 'Row' },
                { value: 'STATEMENT', label: 'Statement' },
              ]}
            />
          </div>
        </div>
        <div>
          <Label>Function to trigger</Label>
          {fns.length > 0 ? (
            <Select mono value={fn} onValueChange={setFn} placeholder="Choose a function…" options={fns.map((f) => ({ value: f, label: `${f}()` }))} />
          ) : (
            <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground/80">
              No trigger functions in <code className="text-muted-foreground">{schema}</code> yet — create one under Functions with
              return type <code className="text-muted-foreground">trigger</code> first.
            </p>
          )}
        </div>
      </div>
    </Sheet>
  )
}
