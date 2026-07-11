import { Lock, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type Column, type TableInfo } from '../../api'
import { Badge, Button, ConfirmDialog, Input, Kbd, Label, Select, Sheet, SheetClose, Textarea } from '../../components/ui'
import { FkField, ForeignKeySheet, type Fk } from './fk'
import { coerce, nowFor } from './model'

/** Maps an enum type name to its ordered labels; fetched once per sheet. */
type EnumMap = Record<string, string[]>

/**
 * Supabase-style side sheet for inserting or updating a single row.
 *
 * Identity/default primary keys are auto-generated on insert and omitted from the form;
 * on update, primary keys are locked and never sent as part of the patch.
 *
 * @param table - The table whose row is being edited.
 * @param tables - All tables, needed to browse foreign-key targets.
 * @param initial - The row's initial field values.
 * @param isNew - Whether this is an insert (`true`) rather than an update.
 * @param onClose - Closes the sheet.
 * @param onSave - Persists the row patch.
 * @param onDelete - Deletes the row; only available when updating an existing row.
 * @returns The row insert/update sheet.
 */
export function RowSheet({
  table,
  tables,
  initial,
  isNew,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: {
  table: TableInfo
  tables: TableInfo[]
  initial: Record<string, unknown>
  isNew?: boolean
  /** view / no-PK rows: show every field locked, no save or delete */
  readOnly?: boolean
  onClose: () => void
  onSave: (row: Record<string, unknown>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const editable = table.columns.filter((c) => !(isNew && c.isPrimaryKey && c.hasDefault))
  const [form, setForm] = useState<Record<string, string>>(() => {
    const f: Record<string, string> = {}
    for (const c of editable) {
      const v = initial[c.name]
      f[c.name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)
    }
    return f
  })
  const [nulls, setNulls] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (!isNew) for (const c of editable) if (initial[c.name] === null) s.add(c.name)
    return s
  })
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [fkPicking, setFkPicking] = useState<{ col: string; fk: Fk } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [enums, setEnums] = useState<EnumMap>({})

  useEffect(() => {
    api
      .sql(
        `select t.typname as name, e.enumlabel as label
         from pg_enum e join pg_type t on t.oid = e.enumtypid
         order by t.typname, e.enumsortorder`
      )
      .then((res) => {
        if (!res.ok || !res.rows) return
        const map: EnumMap = {}
        for (const r of res.rows as { name: string; label: string }[]) (map[r.name] ??= []).push(r.label)
        setEnums(map)
      })
      .catch(() => {})
  }, [])

  function setField(name: string, value: string) {
    setForm((f) => ({ ...f, [name]: value }))
    setTouched((t) => new Set(t).add(name))
    setNulls((n) => {
      if (!n.has(name)) return n
      const next = new Set(n)
      next.delete(name)
      return next
    })
  }

  function toggleNull(name: string) {
    setTouched((t) => new Set(t).add(name))
    setNulls((n) => {
      const next = new Set(n)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function submit() {
    if (readOnly) return
    setErr('')
    for (const c of editable) {
      const raw = form[c.name] ?? ''
      if (nulls.has(c.name) || raw === '' || raw === '__null') continue
      if (c.type === 'json' || c.type === 'jsonb' || c.type.startsWith('_')) {
        try {
          JSON.parse(raw)
        } catch {
          return setErr(`"${c.name}": not valid JSON — fix it or set the field to NULL.`)
        }
      }
      if (/^(int|float|numeric)/.test(c.type) && Number.isNaN(Number(raw))) {
        return setErr(`"${c.name}": "${raw}" is not a number.`)
      }
    }
    if (isNew) {
      for (const c of editable) {
        if (!c.nullable && !c.hasDefault && (form[c.name] ?? '') === '' && !nulls.has(c.name)) {
          return setErr(`"${c.name}" is required.`)
        }
      }
    }

    setBusy(true)
    const out: Record<string, unknown> = {}
    for (const c of editable) {
      if (!isNew && c.isPrimaryKey) continue
      if (!isNew && !touched.has(c.name)) continue
      if (nulls.has(c.name)) {
        out[c.name] = null
        continue
      }
      const raw = form[c.name] ?? ''
      if (raw === '__null') {
        out[c.name] = null
        continue
      }
      if (raw === '') {
        if (!isNew && c.nullable) out[c.name] = null
        continue
      }
      out[c.name] = coerce(raw, c.type)
    }
    try {
      await onSave(out)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={
        <span>
          {readOnly ? 'View row from ' : isNew ? 'Insert row into ' : 'Update row from '}
          <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{table.name}</code>
        </span>
      }
      footer={
        readOnly ? (
          <SheetClose asChild>
            <Button variant="outline" className="ml-auto">
              Close
            </Button>
          </SheetClose>
        ) : (
          <>
            {!isNew && onDelete && (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={13} /> Delete row
              </Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="mr-1 hidden items-center gap-1 text-[11px] text-muted-foreground/60 sm:flex">
                <Kbd>Ctrl</Kbd>+<Kbd>↵</Kbd> to save
              </span>
              <SheetClose asChild>
                <Button variant="outline">Cancel</Button>
              </SheetClose>
              <Button onClick={() => void submit()} disabled={busy}>
                {busy ? 'Saving…' : isNew ? 'Insert row' : 'Save changes'}
              </Button>
            </div>
          </>
        )
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit()
        }}
      >
        {isNew && table.columns.some((c) => c.isPrimaryKey && c.hasDefault) && (
          <p className="rounded-md border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground/80">
            Primary key{' '}
            <span className="font-mono text-muted-foreground">
              {table.columns
                .filter((c) => c.isPrimaryKey && c.hasDefault)
                .map((c) => c.name)
                .join(', ')}
            </span>{' '}
            is generated automatically.
          </p>
        )}

        {editable.map((c) => {
          const fk = table.foreignKeys.find((f) => f.columns.includes(c.name))
          const isNull = nulls.has(c.name)
          const required = !c.nullable && !c.hasDefault
          const isTemporal = /^(timestamp|date|time)/.test(c.type)
          const locked = readOnly || (!isNew && c.isPrimaryKey)
          return (
            <div key={c.name}>
              <div className="mb-1 flex items-center gap-1.5">
                <Label>
                  <span className="font-mono text-foreground/80">{c.name}</span>
                </Label>
                <span className="mb-1 text-[11px] text-muted-foreground/60">{c.type}</span>
                {c.isPrimaryKey && (
                  <Badge variant="amber" className="mb-1">
                    {locked && <Lock size={9} />} PK
                  </Badge>
                )}
                {required && !locked && (
                  <Badge variant="red" className="mb-1">
                    required
                  </Badge>
                )}
                {!locked && (
                  <span className="mb-1 ml-auto flex items-center gap-1">
                    {isTemporal && !isNull && <FieldAction label="now" onClick={() => setField(c.name, nowFor(c.type))} />}
                    {c.type === 'uuid' && !fk && !isNull && (
                      <FieldAction label="generate" onClick={() => setField(c.name, crypto.randomUUID())} />
                    )}
                    {c.nullable && c.type !== 'bool' && (
                      <FieldAction label="NULL" active={isNull} onClick={() => toggleNull(c.name)} />
                    )}
                  </span>
                )}
              </div>

              {locked ? (
                <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 font-mono text-[13px] text-muted-foreground/80">
                  <Lock size={11} className="shrink-0 text-muted-foreground/60" />
                  <span className="truncate">{form[c.name] || 'NULL'}</span>
                </div>
              ) : fk ? (
                <FkField
                  fk={fk}
                  value={isNull ? '' : (form[c.name] ?? '')}
                  disabled={isNull}
                  placeholder={c.hasDefault ? 'default — or select a record' : 'Select a record…'}
                  onOpen={() => setFkPicking({ col: c.name, fk })}
                />
              ) : (
                <FieldControl
                  col={c}
                  enums={enums}
                  value={isNull ? '' : (form[c.name] ?? '')}
                  disabled={isNull}
                  onChange={(v) => setField(c.name, v)}
                />
              )}
            </div>
          )
        })}
        {err && <p className="wrap-break-word rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
      </div>

      {confirmingDelete && onDelete && (
        <ConfirmDialog
          open
          danger
          title="Delete this row?"
          description="The row will be permanently deleted. This cannot be undone."
          confirmLabel="Delete row"
          onConfirm={() => void onDelete().catch((e) => setErr((e as Error).message))}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
      {fkPicking && (
        <ForeignKeySheet
          fk={fkPicking.fk}
          tables={tables}
          currentKey={form[fkPicking.col] || null}
          onClose={() => setFkPicking(null)}
          onPick={(values) => {
            for (const [src, v] of Object.entries(values)) {
              setField(src, v === null || v === undefined ? '' : String(v))
            }
          }}
        />
      )}
    </Sheet>
  )
}

function FieldAction({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={
        'rounded border px-1.5 py-px text-[10px] transition-colors ' +
        (active
          ? 'border-brand/50 bg-brand/15 text-brand'
          : 'border-input text-muted-foreground/80 hover:border-muted-foreground hover:text-foreground/80')
      }
      onClick={onClick}
    >
      {label}
    </button>
  )
}

function FieldControl({
  col,
  enums,
  value,
  disabled,
  onChange,
}: {
  col: Column
  enums: EnumMap
  value: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  const placeholder = disabled ? 'NULL' : col.hasDefault ? 'default' : col.nullable ? 'NULL' : ''
  const unsetLabel = col.hasDefault ? 'default' : col.nullable ? 'NULL' : '—'
  if (col.type === 'bool') {
    return (
      <Select
        mono
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={[
          { value: '', label: unsetLabel },
          { value: 'true' },
          { value: 'false' },
          ...(col.nullable ? [{ value: '__null', label: 'NULL' }] : []),
        ]}
      />
    )
  }
  if (enums[col.type]) {
    return (
      <Select
        mono
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        options={[{ value: '', label: unsetLabel }, ...enums[col.type].map((l) => ({ value: l }))]}
      />
    )
  }
  if (col.type === 'json' || col.type === 'jsonb' || col.type.startsWith('_')) {
    return <Textarea rows={4} value={value} disabled={disabled} placeholder={placeholder || '{ }'} onChange={(e) => onChange(e.target.value)} />
  }
  if (col.type === 'text') {
    return (
      <Textarea
        rows={value.length > 80 || value.includes('\n') ? 4 : 2}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }
  return (
    <Input
      mono
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      inputMode={/^(int|float|numeric)/.test(col.type) ? 'decimal' : undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
