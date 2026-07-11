import { Eye, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import {
  Badge,
  Button,
  CodeEditor,
  CodeView,
  ConfirmDialog,
  Empty,
  Input,
  Label,
  Select,
  Sheet,
  SheetClose,
  Spinner,
  Switch,
  Table,
  Td,
  Th,
  THead,
  TRow,
  toast,
} from '../../components/ui'
import { CatalogHeader, quoteIdent, useDbSchema } from './shared'

interface Fn {
  name: string
  args: string
  returns: string
  language: string
  security_definer?: boolean
  body: string
}

/** User-defined database functions: browse, filter, view source, create, drop. */
export function FunctionsSection() {
  const [schema] = useDbSchema()
  const [fns, setFns] = useState<Fn[] | null>(null)
  const [search, setSearch] = useState('')
  const [retFilter, setRetFilter] = useState('')
  const [secFilter, setSecFilter] = useState('')
  const [viewing, setViewing] = useState<Fn | null>(null)
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<Fn | null>(null)

  const load = useCallback(() => {
    api.functions(schema).then(
      (f) => setFns(f as Fn[]),
      () => setFns([])
    )
  }, [schema])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync with SQL-editor DDL
    return () => clearInterval(t)
  }, [load])

  const returnTypes = useMemo(() => [...new Set((fns ?? []).map((f) => f.returns))].sort(), [fns])

  async function drop(fn: Fn) {
    const res = await api.sql(`drop function ${quoteIdent(schema)}.${quoteIdent(fn.name)}(${fn.args ?? ''})`)
    if (!res.ok) {
      toast.error(res.error ?? 'Drop failed')
      return
    }
    toast.success(`Dropped function ${fn.name}`)
    load()
  }

  if (fns === null) return <Spinner />
  const visible = fns.filter(
    (f) =>
      f.name.toLowerCase().includes(search.toLowerCase()) &&
      (!retFilter || f.returns === retFilter) &&
      (!secFilter || (secFilter === 'definer') === Boolean(f.security_definer))
  )

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Functions"
        description="User-defined functions in the selected schema — usable from SQL, triggers, and RPC."
        search={search}
        onSearch={setSearch}
        onRefresh={load}
        schemaPicker
        filters={
          <>
            <Select
              className="w-36 shrink-0"
              value={retFilter}
              onValueChange={setRetFilter}
              placeholder="Return type"
              options={[{ value: '', label: 'All return types' }, ...returnTypes.map((t) => ({ value: t }))]}
            />
            <Select
              className="w-32 shrink-0"
              value={secFilter}
              onValueChange={setSecFilter}
              placeholder="Security"
              options={[
                { value: '', label: 'All security' },
                { value: 'definer', label: 'Definer' },
                { value: 'invoker', label: 'Invoker' },
              ]}
            />
          </>
        }
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New function
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Arguments</Th>
              <Th>Returns</Th>
              <Th>Language</Th>
              <Th>Security</Th>
              <Th className="w-20" />
            </tr>
          </THead>
          <tbody>
            {visible.map((f) => (
              <TRow key={f.name + f.args}>
                <Td className="font-mono text-foreground/90">{f.name}</Td>
                <Td className="max-w-70 truncate font-mono text-[11px] text-muted-foreground/80">{f.args || '—'}</Td>
                <Td className="font-mono text-muted-foreground">{f.returns}</Td>
                <Td className="text-muted-foreground">{f.language}</Td>
                <Td>{f.security_definer ? <Badge variant="amber">definer</Badge> : <Badge variant="neutral">invoker</Badge>}</Td>
                <Td>
                  <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                    <button className="p-1 text-muted-foreground/80 hover:text-foreground" title="View source" onClick={() => setViewing(f)}>
                      <Eye size={13} />
                    </button>
                    <button className="p-1 text-muted-foreground/80 hover:text-destructive" title="Drop" onClick={() => setDropping(f)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {visible.length === 0 && <Empty>{fns.length === 0 ? 'No user functions yet.' : 'No match.'}</Empty>}
      </div>

      {viewing && (
        <Sheet
          open
          onClose={() => setViewing(null)}
          width="w-[640px]"
          title={
            <span>
              Source of <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{viewing.name}</code>
            </span>
          }
          footer={
            <SheetClose asChild>
              <Button variant="outline" className="ml-auto">
                Done
              </Button>
            </SheetClose>
          }
        >
          <CodeView value={viewing.body?.trim() ?? '-- source unavailable'} lang="sql" readOnly gutter minLines={6} maxLines={400} />
        </Sheet>
      )}
      {creating && (
        <CreateFunctionSheet
          schema={schema}
          onDone={() => {
            setCreating(false)
            load()
          }}
          onClose={() => setCreating(false)}
        />
      )}
      {dropping && (
        <ConfirmDialog
          open
          danger
          title={`Drop function "${dropping.name}"?`}
          description="Triggers and RPC calls that use it will fail. This cannot be undone."
          confirmLabel="Drop function"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

const RETURN_TYPES = ['void', 'trigger', 'text', 'int4', 'int8', 'numeric', 'bool', 'uuid', 'jsonb', 'timestamptz', 'record']
const ARG_TYPES = ['text', 'int4', 'int8', 'numeric', 'bool', 'uuid', 'jsonb', 'timestamptz', 'date']

const DEFAULT_BODY: Record<string, string> = {
  plpgsql: 'begin\n\nend;',
  sql: 'select 1;',
}

/**
 * Supabase-style function builder in a side sheet: name, arguments, return
 * type, body — with advanced settings (language, SECURITY DEFINER) behind a
 * toggle. The final CREATE OR REPLACE FUNCTION is assembled from the fields.
 */
function CreateFunctionSheet({ schema, onDone, onClose }: { schema: string; onDone: () => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [args, setArgs] = useState<{ name: string; type: string }[]>([])
  const [returns, setReturns] = useState('void')
  const [language, setLanguage] = useState<'plpgsql' | 'sql'>('plpgsql')
  const [body, setBody] = useState(DEFAULT_BODY.plpgsql)
  const [definer, setDefiner] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  const argList = args
    .filter((a) => a.name.trim())
    .map((a) => `${q(a.name.trim())} ${a.type}`)
    .join(', ')
  const sql = `create or replace function ${q(schema)}.${q(name.trim() || 'my_function')}(${argList})
returns ${returns}
language ${language}${definer ? '\nsecurity definer' : ''}
as $$
${body}
$$;`

  async function create() {
    if (!name.trim()) return setErr('Function name is required.')
    setBusy(true)
    setErr('')
    const res = await api.sql(sql)
    if (!res.ok) {
      setErr(res.error ?? 'Create failed')
      setBusy(false)
      return
    }
    toast.success(`Created function ${name.trim()}`)
    onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-160"
      title="Add a new function"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create function'}
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
          <Label>Name of function</Label>
          <Input mono value={name} autoFocus placeholder="my_function" onChange={(e) => setName(e.target.value.replace(/\s/g, '_'))} />
        </div>
        <div>
          <Label>Return type</Label>
          <Select mono value={returns} onValueChange={setReturns} options={RETURN_TYPES.map((t) => ({ value: t }))} />
        </div>
      </div>

      <div>
        <Label>
          Arguments <span className="font-normal text-muted-foreground/60">— referenced in the body by name</span>
        </Label>
        <div className="space-y-1.5">
          {args.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                mono
                value={a.name}
                placeholder="arg_name"
                onChange={(e) => setArgs((cur) => cur.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))}
              />
              <Select
                mono
                className="w-36 shrink-0"
                value={a.type}
                onValueChange={(t) => setArgs((cur) => cur.map((x, xi) => (xi === i ? { ...x, type: t } : x)))}
                options={ARG_TYPES.map((t) => ({ value: t }))}
              />
              <Button variant="ghost" size="iconXs" title="Remove" onClick={() => setArgs((cur) => cur.filter((_, xi) => xi !== i))}>
                <Trash2 size={12} className="text-muted-foreground" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="xs" className="mt-1.5" onClick={() => setArgs((cur) => [...cur, { name: '', type: 'text' }])}>
          <Plus size={12} /> Add a new argument
        </Button>
      </div>

      <div>
        <Label>
          Definition <span className="font-normal text-muted-foreground/60">— written in {language}</span>
        </Label>
        <CodeEditor lang="sql" className="h-44" value={body} onChange={setBody} onCmdEnter={() => void create()} />
      </div>

      <button
        className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-left text-[13px] text-foreground/85 transition-colors hover:border-muted-foreground/60"
        onClick={() => setAdvanced((a) => !a)}
      >
        Show advanced settings
        <Switch checked={advanced} onChange={() => setAdvanced((a) => !a)} />
      </button>
      {advanced && (
        <div className="space-y-3 rounded-md border border-border bg-card p-3">
          <div>
            <Label>Language</Label>
            <Select
              mono
              value={language}
              onValueChange={(l) => {
                setLanguage(l as typeof language)
                setBody((b) => (Object.values(DEFAULT_BODY).includes(b) ? DEFAULT_BODY[l] : b))
              }}
              options={[{ value: 'plpgsql' }, { value: 'sql' }]}
            />
          </div>
          <label className="flex items-center gap-3 text-[13px] text-foreground/85">
            <Switch checked={definer} onChange={setDefiner} />
            <span>
              SECURITY DEFINER <span className="text-[11px] text-muted-foreground/60">— runs with the owner's privileges (bypasses caller RLS)</span>
            </span>
          </label>
        </div>
      )}

      <div>
        <Label>Preview of SQL statement</Label>
        <CodeView value={sql} lang="sql" readOnly minLines={4} maxLines={10} />
      </div>
    </div>
    </Sheet>
  )
}
