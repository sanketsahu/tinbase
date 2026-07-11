import { AlertTriangle } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import { Button, Checkbox, CodeEditor, Dialog, Input, Label, Select, toast } from '../../components/ui'
import { qualify } from '../../lib/schema'

const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"'

/**
 * Runs one SQL statement.
 *
 * @param sql - The statement to execute.
 * @returns An error message if it failed, or `null` on success.
 */
async function runSql(sql: string): Promise<string | null> {
  const res = await api.sql(sql)
  return res.ok ? null : (res.error ?? 'Statement failed')
}

/* ── new table ──────────────────────────────────────────────────────────────── */

const NEW_TABLE_TEMPLATE = `create table new_table (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);`

/**
 * Dialog for creating a new table from free-form Postgres DDL.
 *
 * The created table name is parsed out of the DDL so it can be auto-selected afterwards.
 *
 * @param onClose - Closes the dialog.
 * @param onDone - Called after a successful create, with the parsed table name if one was found.
 * @returns The new-table dialog.
 */
export function NewTableDialog({
  schema = 'public',
  onClose,
  onDone,
}: {
  schema?: string
  onClose: () => void
  onDone: (table?: string) => Promise<void>
}) {
  const [sql, setSql] = useState(schema === 'public' ? NEW_TABLE_TEMPLATE : NEW_TABLE_TEMPLATE.replace('create table ', `create table ${quote(schema)}.`))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setErr('')
    const e = await runSql(sql)
    if (e) {
      setErr(e)
      setBusy(false)
      return
    }
    const m = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"([^"]+)"|([\w.]+))/i.exec(sql)
    const name = (m?.[1] ?? m?.[2])?.split('.').pop()
    toast.success(`Created table${name ? ` ${name}` : ''}`)
    await onDone(name ?? undefined)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title="New table" wide>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground/80">
          Define the table in SQL — full Postgres DDL is supported (constraints, references, checks…).
        </p>
        <CodeEditor lang="sql" className="h-56" value={sql} onChange={setSql} onCmdEnter={() => void create()} />
        {err && <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={busy || !sql.trim()}>
            {busy ? 'Creating…' : 'Create table'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ── add column ─────────────────────────────────────────────────────────────── */

const COLUMN_TYPES = ['text', 'int8', 'int4', 'numeric', 'float8', 'bool', 'uuid', 'timestamptz', 'date', 'jsonb']

/** Dialog appending a column to a table via ALTER TABLE ADD COLUMN. */
export function AddColumnDialog({
  table,
  schema = 'public',
  onClose,
  onDone,
}: {
  table: string
  schema?: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text')
  const [nullable, setNullable] = useState(true)
  const [defaultExpr, setDefaultExpr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    if (!name.trim()) return
    setBusy(true)
    setErr('')
    let sql = `alter table ${qualify(schema, table)} add column ${quote(name.trim())} ${type}`
    if (!nullable) sql += ' not null'
    if (defaultExpr.trim()) sql += ` default ${defaultExpr.trim()}`
    const e = await runSql(sql)
    if (e) {
      setErr(e)
      setBusy(false)
      return
    }
    toast.success(`Added column ${name.trim()}`)
    await onDone()
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title={`Add column to "${table}"`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input mono value={name} autoFocus placeholder="status" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Type</Label>
            <Select mono value={type} onValueChange={setType} options={COLUMN_TYPES.map((t) => ({ value: t }))} />
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/80">
          <Checkbox checked={nullable} onChange={setNullable} />
          Nullable
        </label>
        <div>
          <Label>
            Default <span className="font-normal text-muted-foreground/60">— raw SQL expression, e.g. now() or 'draft'</span>
          </Label>
          <Input
            mono
            value={defaultExpr}
            placeholder="(none)"
            onChange={(e) => setDefaultExpr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void submit()}
          />
        </div>
        {err && <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add column'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ── rename table ───────────────────────────────────────────────────────────── */

/**
 * Dialog for renaming a table.
 *
 * @param table - The current table name.
 * @param onClose - Closes the dialog.
 * @param onDone - Called after a successful rename, with the new name.
 * @returns The rename-table dialog.
 */
export function RenameTableDialog({
  table,
  schema = 'public',
  onClose,
  onDone,
}: {
  table: string
  schema?: string
  onClose: () => void
  onDone: (newName: string) => Promise<void>
}) {
  const [name, setName] = useState(table)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const to = name.trim()
    if (!to || to === table) return onClose()
    setBusy(true)
    const e = await runSql(`alter table ${qualify(schema, table)} rename to ${quote(to)}`)
    setBusy(false)
    if (e) {
      toast.error(e)
      return
    }
    toast.success(`Renamed ${table} → ${to}`)
    await onDone(to)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title={`Rename table "${table}"`}>
      <div className="space-y-3">
        <div>
          <Label>New name</Label>
          <Input mono value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ── duplicate table ────────────────────────────────────────────────────────── */

/**
 * Dialog for duplicating a table, optionally copying its rows.
 *
 * Copies columns, defaults, not-null constraints and indexes; foreign keys are not copied.
 * The structure is created first, then rows are copied when requested.
 *
 * @param table - The table to duplicate.
 * @param onClose - Closes the dialog.
 * @param onDone - Called after the copy, with the new table name.
 * @returns The duplicate-table dialog.
 */
export function DuplicateTableDialog({
  table,
  schema = 'public',
  onClose,
  onDone,
}: {
  table: string
  schema?: string
  onClose: () => void
  onDone: (newName: string) => Promise<void>
}) {
  const [name, setName] = useState(`${table}_copy`)
  const [withData, setWithData] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    const to = name.trim()
    if (!to) return
    setBusy(true)
    setErr('')
    const e1 = await runSql(`create table ${qualify(schema, to)} (like ${qualify(schema, table)} including all)`)
    if (e1) {
      setErr(e1)
      setBusy(false)
      return
    }
    if (withData) {
      const e2 = await runSql(`insert into ${qualify(schema, to)} select * from ${qualify(schema, table)}`)
      if (e2) {
        setErr(`Table created, but copying rows failed: ${e2}`)
        setBusy(false)
        await onDone(to)
        return
      }
    }
    toast.success(`Duplicated ${table} → ${to}`)
    await onDone(to)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title={`Duplicate table "${table}"`}>
      <div className="space-y-3">
        <div>
          <Label>New table name</Label>
          <Input mono value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/80">
          <Checkbox checked={withData} onChange={setWithData} />
          Copy the rows too
        </label>
        <p className="text-[11px] text-muted-foreground/60">
          Copies columns, defaults, not-null constraints and indexes. Foreign keys are not copied.
        </p>
        {err && <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Duplicating…' : 'Duplicate'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

/* ── delete table ───────────────────────────────────────────────────────────── */

/**
 * Confirmation dialog for dropping a table, optionally with CASCADE.
 *
 * @param table - The table to delete.
 * @param onClose - Closes the dialog.
 * @param onDone - Called after the table is dropped.
 * @returns The delete-table dialog.
 */
export function DeleteTableDialog({
  table,
  schema = 'public',
  onClose,
  onDone,
}: {
  table: string
  schema?: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [cascade, setCascade] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit() {
    setBusy(true)
    setErr('')
    const e = await runSql(`drop table ${qualify(schema, table)}${cascade ? ' cascade' : ''}`)
    if (e) {
      setErr(e)
      setBusy(false)
      return
    }
    toast.success(`Dropped table ${table}`)
    await onDone()
    onClose()
  }

  return (
    <Dialog open onClose={onClose} title={`Delete table "${table}"?`}>
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            <AlertTriangle size={15} className="text-destructive" />
          </div>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            The table and all of its rows will be permanently deleted. This cannot be undone.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/80">
          <Checkbox checked={cascade} onChange={setCascade} />
          Also drop dependent objects (CASCADE)
        </label>
        {err && <p className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="dangerSolid" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete table'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
