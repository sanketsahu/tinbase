import { AlertCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Button, ConfirmDialog, Empty, Input, Label, Sheet, SheetClose, Spinner, toast } from '../../components/ui'
import { qualify } from '../../lib/schema'
import { CatalogHeader, quoteIdent, quoteLit, useDbSchema } from './shared'

interface EnumType {
  name: string
  values: string[]
  comment: string | null
}

/** User-defined enum types: browse, create, edit (rename type/values, add values), drop. */
export function EnumsSection() {
  const [schema] = useDbSchema()
  const [enums, setEnums] = useState<EnumType[] | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<EnumType | null>(null)
  const [dropping, setDropping] = useState<EnumType | null>(null)

  const load = useCallback(async () => {
    const res = await api.sql(
      `select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as values,
              obj_description(t.oid, 'pg_type') as comment
       from pg_type t join pg_enum e on e.enumtypid = t.oid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = ${quoteLit(schema)}
       group by t.typname, t.oid order by t.typname`
    )
    setEnums(res.ok ? ((res.rows ?? []) as EnumType[]) : [])
  }, [schema])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync with SQL-editor DDL
    return () => clearInterval(t)
  }, [load])

  async function drop(e: EnumType) {
    const res = await api.sql(`drop type ${qualify(schema, e.name)}`)
    if (!res.ok) {
      toast.error(res.error ?? 'Drop failed — is the type still used by a column?')
      return
    }
    toast.success(`Dropped type ${e.name}`)
    await load()
  }

  if (enums === null) return <Spinner />
  const visible = enums.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Enumerated Types"
        description="Custom enum types — columns using them render as dropdowns in the table editor."
        search={search}
        onSearch={setSearch}
        onRefresh={() => void load()}
        schemaPicker
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New type
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-6">
        {visible.map((e) => (
          <div key={e.name} className="rounded-md border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[13px] text-foreground">{e.name}</span>
              <span className="text-[11px] text-muted-foreground/60">{e.values.length} values</span>
              {e.comment && (
                <span className="truncate text-[11px] text-muted-foreground/60" title={e.comment}>
                  — {e.comment}
                </span>
              )}
              <div className="ml-auto flex gap-0.5">
                <Button variant="ghost" size="iconXs" title="Edit type" onClick={() => setEditing(e)}>
                  <Pencil size={12} />
                </Button>
                <Button variant="ghost" size="iconXs" title="Drop type" onClick={() => setDropping(e)}>
                  <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
                </Button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.values.map((v) => (
                <Badge key={v} variant="outline" className="font-mono">
                  {v}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        {visible.length === 0 && <Empty>{enums.length === 0 ? 'No enum types yet.' : 'No match.'}</Empty>}
      </div>

      {creating && (
        <EnumTypeSheet
          schema={schema}
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}
      {editing && (
        <EnumTypeSheet
          schema={schema}
          existing={editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
      {dropping && (
        <ConfirmDialog
          open
          danger
          title={`Drop type "${dropping.name}"?`}
          description="Fails if any column still uses the type. This cannot be undone."
          confirmLabel="Drop type"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

/**
 * Create / edit an enum type in a side sheet. Postgres allows renaming the
 * type, renaming values, and APPENDING values — existing values can never be
 * removed or reordered (that requires drop + recreate), matching Supabase.
 */
function EnumTypeSheet({
  schema,
  existing,
  onClose,
  onDone,
}: {
  schema: string
  existing?: EnumType
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.comment ?? '')
  /** existing values (renamable, not removable) mirrored by index to their originals */
  const [values, setValues] = useState<string[]>(existing ? [...existing.values] : [''])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const originalCount = existing?.values.length ?? 0

  async function run(sql: string): Promise<boolean> {
    const res = await api.sql(sql)
    if (!res.ok) {
      setErr(res.error ?? 'Statement failed')
      setBusy(false)
      return false
    }
    return true
  }

  async function save() {
    const trimmed = values.map((v) => v.trim())
    const finalName = name.trim()
    if (!finalName) return setErr('Name is required.')
    if (trimmed.some((v, i) => !v && i < originalCount)) return setErr('Existing values cannot be blank.')
    const nonEmpty = trimmed.filter(Boolean)
    if (nonEmpty.length === 0) return setErr('At least one value is required.')
    if (new Set(nonEmpty).size !== nonEmpty.length) return setErr('Values must be unique.')
    setBusy(true)
    setErr('')

    if (!existing) {
      if (!(await run(`create type ${qualify(schema, finalName)} as enum (${nonEmpty.map(quoteLit).join(', ')})`))) return
      if (description.trim() && !(await run(`comment on type ${qualify(schema, finalName)} is ${quoteLit(description.trim())}`))) return
      toast.success(`Created type ${finalName}`)
      await onDone()
      return
    }

    // edit: rename values → rename type → append new values → comment
    let typeName = existing.name
    for (let i = 0; i < originalCount; i++) {
      if (trimmed[i] !== existing.values[i]) {
        if (!(await run(`alter type ${qualify(schema, typeName)} rename value ${quoteLit(existing.values[i])} to ${quoteLit(trimmed[i])}`)))
          return
      }
    }
    if (finalName !== existing.name) {
      if (!(await run(`alter type ${qualify(schema, typeName)} rename to ${quoteIdent(finalName)}`))) return
      typeName = finalName
    }
    for (const v of trimmed.slice(originalCount).filter(Boolean)) {
      if (!(await run(`alter type ${qualify(schema, typeName)} add value if not exists ${quoteLit(v)}`))) return
    }
    if ((description.trim() || null) !== (existing.comment ?? null)) {
      const lit = description.trim() ? quoteLit(description.trim()) : 'null'
      if (!(await run(`comment on type ${qualify(schema, typeName)} is ${lit}`))) return
    }
    toast.success(`Updated type ${typeName}`)
    await onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-135"
      title={existing ? `Edit type "${existing.name}"` : 'Create a new enumerated type'}
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Create type'}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input mono value={name} autoFocus={!existing} placeholder="order_status" onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>
            Description <span className="font-normal text-muted-foreground/60">— optional</span>
          </Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div>
          <Label>Values</Label>
          <div className="mb-2 flex items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <AlertCircle size={13} className="mt-px shrink-0" />
            <span>
              {existing
                ? 'Existing values can be renamed but never deleted or re-ordered — that requires dropping and recreating the type.'
                : 'After creation, values cannot be deleted or sorted — only renamed or appended.'}
            </span>
          </div>
          <div className="space-y-1.5">
            {values.map((v, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  mono
                  value={v}
                  placeholder={i < originalCount ? undefined : 'new value'}
                  onChange={(e) => setValues((vs) => vs.map((x, xi) => (xi === i ? e.target.value : x)))}
                />
                {i >= originalCount && (
                  <Button
                    variant="ghost"
                    size="iconXs"
                    title="Remove"
                    onClick={() => setValues((vs) => vs.filter((_, xi) => xi !== i))}
                  >
                    <Trash2 size={12} className="text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          <Button variant="outline" size="xs" className="mt-2" onClick={() => setValues((vs) => [...vs, ''])}>
            <Plus size={12} /> Add value
          </Button>
        </div>

      </div>
    </Sheet>
  )
}
