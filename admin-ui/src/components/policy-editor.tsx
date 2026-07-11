import { ChevronDown, Circle, CircleDot, Lock, PanelRightClose, PanelRightOpen, Search, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { Badge, Button, Checkbox, Input, Label, Popover, Select, Sheet, SheetClose, toast, type BadgeVariant } from './ui'

type Cmd = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'
const COMMANDS: Cmd[] = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL']

const needsUsing = (c: Cmd) => c !== 'INSERT'
const needsCheck = (c: Cmd) => c === 'INSERT' || c === 'UPDATE' || c === 'ALL'

const CMD_BADGE: Record<Cmd, BadgeVariant> = {
  SELECT: 'brand',
  INSERT: 'amber',
  UPDATE: 'blue',
  DELETE: 'red',
  ALL: 'neutral',
}

/* ── templates (mirroring Supabase's catalog) ───────────────────────────────── */

interface Template {
  title: string
  description: ReactNode
  command: Cmd
  roles: string[]
  using?: string
  check?: string
}

const TEMPLATES: Template[] = [
  {
    title: 'Enable read access for all users',
    description: 'This policy gives read access to your table for all users via the SELECT operation.',
    command: 'SELECT',
    roles: [],
    using: 'true',
  },
  {
    title: 'Enable insert for authenticated users only',
    description: 'This policy gives insert access to your table for all authenticated users only.',
    command: 'INSERT',
    roles: ['authenticated'],
    check: 'true',
  },
  {
    title: 'Enable delete for users based on user_id',
    description:
      'This policy assumes that your table has a column "user_id", and allows users to delete rows which the "user_id" column matches their ID.',
    command: 'DELETE',
    roles: [],
    using: '(select auth.uid()) = user_id',
  },
  {
    title: 'Enable insert for users based on user_id',
    description:
      'This policy assumes that your table has a column "user_id", and allows users to insert rows which the "user_id" column matches their ID.',
    command: 'INSERT',
    roles: [],
    check: '(select auth.uid()) = user_id',
  },
  {
    title: 'Enable users to view their own data only',
    description: 'Restrict users to reading only their own data, matching "user_id" against their ID.',
    command: 'SELECT',
    roles: ['authenticated'],
    using: '(select auth.uid()) = user_id',
  },
  {
    title: 'Policy with table joins',
    description: (
      <>
        Query across tables to build more advanced RLS rules. Assuming 2 tables called{' '}
        <code className="rounded bg-accent px-1 text-[11px]">teams</code> and{' '}
        <code className="rounded bg-accent px-1 text-[11px]">members</code>, you can query both tables in the policy to control
        access to the members table.
      </>
    ),
    command: 'UPDATE',
    roles: [],
    using: 'team_id in (select team_id from members where user_id = (select auth.uid()))',
    check: 'team_id in (select team_id from members where user_id = (select auth.uid()))',
  },
  {
    title: 'Policy with security definer functions',
    description: (
      <>
        Useful in a many-to-many relationship where you want to restrict access to the linking table. Use a{' '}
        <code className="rounded bg-accent px-1 text-[11px]">security definer</code> function in combination with a policy to
        avoid recursive RLS lookups.
      </>
    ),
    command: 'ALL',
    roles: [],
    using: 'team_id in (select private.get_teams_for_user((select auth.uid())))',
    check: 'team_id in (select private.get_teams_for_user((select auth.uid())))',
  },
  {
    title: 'Policy to implement Time To Live (TTL)',
    description:
      'Implement a TTL-like feature as seen in Instagram stories or Snapchat. Rows are only visible if they were created within the last 24 hours.',
    command: 'SELECT',
    roles: ['authenticated'],
    using: "created_at > (current_timestamp - interval '1 day')",
  },
]

/* ── editor sheet ───────────────────────────────────────────────────────────── */

/** An existing policy loaded into the editor for editing. */
export interface PolicyDraft {
  name: string
  command: Cmd
  behavior: 'PERMISSIVE' | 'RESTRICTIVE'
  roles: string[]
  using: string | null
  check: string | null
}

/**
 * Sheet for creating — or, with `existing`, editing — a Row Level Security
 * policy on a table. Offers a template gallery, a role picker sourced from
 * the live database, and a live SQL preview with editable `using` /
 * `with check` expression slots.
 *
 * Editing is drop-and-recreate (Postgres can't ALTER a policy's command);
 * if the recreate fails the original policy is restored.
 *
 * @param props.table - Name of the table the policy applies to.
 * @param props.existing - When set, the sheet edits this policy instead of creating.
 * @param props.onClose - Called to dismiss the sheet.
 * @param props.onCreated - Called after a policy is successfully saved.
 */
export function PolicyEditorSheet({
  table: fixedTable,
  tables,
  schema = 'public',
  existing,
  onClose,
  onCreated,
}: {
  /** target table; omit (and pass `tables`) to let the user pick one inline */
  table?: string
  /** selectable tables when no fixed table is given */
  tables?: string[]
  schema?: string
  existing?: PolicyDraft
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [table, setTable] = useState(fixedTable ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [behavior, setBehavior] = useState<'PERMISSIVE' | 'RESTRICTIVE'>(existing?.behavior ?? 'PERMISSIVE')
  const [command, setCommand] = useState<Cmd>(existing?.command ?? 'SELECT')
  const [roles, setRoles] = useState<string[]>(existing?.roles.filter((r) => r !== 'public') ?? [])
  const [usingExpr, setUsingExpr] = useState(existing?.using ?? '')
  const [checkExpr, setCheckExpr] = useState(existing?.check ?? '')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showTemplates, setShowTemplates] = useState(!existing)
  const [rolesOpen, setRolesOpen] = useState(false)
  const [allRoles, setAllRoles] = useState<string[]>(['anon', 'authenticated'])

  useEffect(() => {
    api
      .sql(`select rolname from pg_roles where rolname not like 'pg\\_%' order by rolname`)
      .then((res) => {
        const names = (res.rows ?? []).map((r) => (r as { rolname: string }).rolname)
        if (res.ok && names.length > 0) setAllRoles(names)
      })
      .catch(() => {})
  }, [])

  const roleStr = roles.length > 0 ? roles.join(', ') : 'public'

  function applyTemplate(t: Template) {
    setName(t.title)
    setCommand(t.command)
    setRoles(t.roles)
    setUsingExpr(t.using ?? '')
    setCheckExpr(t.check ?? '')
    setErr('')
  }

  async function save() {
    if (!table) return setErr('Pick a table for the policy.')
    if (!name.trim()) return setErr('Policy name is required.')
    setBusy(true)
    setErr('')
    const body = {
      schema,
      table,
      name: name.trim(),
      command,
      behavior,
      roles: roleStr,
      using: needsUsing(command) ? usingExpr.trim() || undefined : undefined,
      check: needsCheck(command) ? checkExpr.trim() || undefined : undefined,
    }
    try {
      if (existing) {
        // drop-and-recreate (a policy's command can't be ALTERed) — restore
        // the original if the recreate is rejected
        await api.dropPolicy(table, existing.name, schema)
        try {
          await api.createPolicy(body)
        } catch (e) {
          await api
            .createPolicy({
              schema,
              table,
              name: existing.name,
              command: existing.command,
              behavior: existing.behavior,
              roles: existing.roles.join(', ') || 'public',
              using: existing.using ?? undefined,
              check: existing.check ?? undefined,
            })
            .catch(() => {})
          throw e
        }
        toast.success(`Updated policy "${name.trim()}"`)
      } else {
        await api.createPolicy(body)
        toast.success(`Created policy "${name.trim()}"`)
      }
      await onCreated()
      onClose()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const templates = TEMPLATES.filter((t) => t.title.toLowerCase().includes(search.toLowerCase()))

  return (
    <Sheet
      open
      onClose={onClose}
      flush
      hideHeader
      width={showTemplates ? 'w-[980px]' : 'w-[640px]'}
      title={existing ? `Edit policy "${existing.name}"` : 'Create a new Row Level Security policy'}
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>
              {busy ? 'Saving…' : 'Save policy'}
            </Button>
          </div>
        </>
      }
    >
      <div className="flex h-full">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border pl-3 pr-2">
            <SheetClose asChild>
              <button className="rounded p-1 text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground">
                <X size={16} />
              </button>
            </SheetClose>
            <h2 className="truncate text-[15px] font-medium text-foreground">
              {existing ? (
                <>
                  Edit policy <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[13px]">{existing.name}</code>
                </>
              ) : (
                'Create a new Row Level Security policy'
              )}
            </h2>
            <button
              onClick={() => setShowTemplates((s) => !s)}
              title={showTemplates ? 'Hide templates' : 'Show templates'}
              className="ml-auto rounded p-1 text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
            >
              {showTemplates ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Policy name</Label>
                <Input value={name} autoFocus placeholder="Provide a name for your policy" onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>
                  Table <ClauseChip>on</ClauseChip>
                </Label>
                {fixedTable || existing ? (
                  <div className="flex h-8 items-center rounded-md border border-border bg-card px-2.5 font-mono text-[13px] text-muted-foreground">
                    {schema}.{table}
                  </div>
                ) : (
                  <Select
                    mono
                    value={table}
                    onValueChange={setTable}
                    placeholder="Pick a table…"
                    options={(tables ?? []).map((t) => ({ value: t, label: `${schema}.${t}` }))}
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  Policy behavior <ClauseChip>as</ClauseChip>
                </Label>
                <Select
                  value={behavior}
                  onValueChange={(v) => setBehavior(v as 'PERMISSIVE' | 'RESTRICTIVE')}
                  options={[
                    { value: 'PERMISSIVE', label: 'Permissive' },
                    { value: 'RESTRICTIVE', label: 'Restrictive' },
                  ]}
                />
              </div>
              <div>
                <Label>
                  Target roles <ClauseChip>to</ClauseChip>
                </Label>
                <Popover
                  open={rolesOpen}
                  onOpenChange={setRolesOpen}
                  className="max-h-56 w-full overflow-auto p-1.5"
                  trigger={
                    <button
                      onClick={() => setRolesOpen((o) => !o)}
                      className="flex h-8 w-full items-center gap-1.5 rounded-md border border-input bg-field px-2.5 text-left text-[13px] transition-colors hover:border-muted-foreground focus:border-brand focus:outline-none"
                    >
                      {roles.length > 0 ? (
                        <span className="truncate font-mono text-foreground">{roles.join(', ')}</span>
                      ) : (
                        <span className="truncate text-muted-foreground/60">Defaults to all (public) roles</span>
                      )}
                      <ChevronDown size={13} className="ml-auto shrink-0 text-muted-foreground/80" />
                    </button>
                  }
                >
                  {allRoles.map((r) => (
                    <label key={r} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground hover:bg-accent">
                      <Checkbox
                        checked={roles.includes(r)}
                        onChange={(on) => setRoles((cur) => (on ? [...cur, r] : cur.filter((x) => x !== r)))}
                      />
                      <span className="font-mono">{r}</span>
                    </label>
                  ))}
                  {roles.length > 0 && (
                    <button className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs text-brand hover:bg-accent" onClick={() => setRoles([])}>
                      Clear — default to public
                    </button>
                  )}
                </Popover>
              </div>
            </div>
            <p className="mt-1.5! text-[11px] text-muted-foreground/60">
              {behavior === 'PERMISSIVE'
                ? 'Permissive policies are combined with OR — a row is visible if any permissive policy allows it.'
                : 'Restrictive policies are combined with AND — they narrow down what permissive policies allow.'}
            </p>

            <div>
              <Label>
                Policy command <ClauseChip>for</ClauseChip>
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {COMMANDS.map((c) => {
                  const active = command === c
                  return (
                    <button
                      key={c}
                      onClick={() => setCommand(c)}
                      className={
                        'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ' +
                        (active
                          ? 'border-foreground bg-accent text-foreground'
                          : 'border-input text-muted-foreground hover:border-muted-foreground hover:text-foreground')
                      }
                    >
                      {active ? <CircleDot size={12} className="text-brand" /> : <Circle size={12} className="text-muted-foreground/60" />}
                      {c}
                    </button>
                  )
                })}
              </div>
            </div>

            <SqlPreview
              name={name}
              schema={schema}
              table={table}
              behavior={behavior}
              command={command}
              roleStr={roleStr}
              usingExpr={needsUsing(command) ? usingExpr : null}
              checkExpr={needsCheck(command) ? checkExpr : null}
              onUsing={setUsingExpr}
              onCheck={setCheckExpr}
            />
          </div>
        </div>

        {/* Templates pane stays mounted so the width collapse animates smoothly. */}
        <div
          className="shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: showTemplates ? 340 : 0 }}
        >
          <div className="flex h-full w-85 flex-col border-l border-border bg-card">
            <div className="flex h-12 shrink-0 items-end border-b border-border px-4">
              <span className="border-b-2 border-foreground pb-3 text-[13px] font-medium text-foreground">Templates</span>
            </div>
            <div className="shrink-0 border-b border-border p-3">
              <div className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search templates…"
                  className="h-8 w-full rounded-md border border-input bg-field pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-muted-foreground focus:outline-none"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {templates.map((t) => (
                <button
                  key={t.title}
                  onClick={() => applyTemplate(t)}
                  className="w-full rounded-md border border-border bg-popover p-3 text-left transition-colors hover:border-muted-foreground"
                >
                  <Badge variant={CMD_BADGE[t.command]}>{t.command}</Badge>
                  <p className="mt-2 text-[13px] font-medium text-foreground">{t.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{t.description}</p>
                </button>
              ))}
              {templates.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground/60">No matching template.</p>}
            </div>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

function ClauseChip({ children }: { children: ReactNode }) {
  return (
    <span className="mx-0.5 rounded border border-input bg-accent px-1 py-px font-mono text-[10px] normal-case text-muted-foreground">
      {children}
    </span>
  )
}

/* ── live SQL preview with editable expression slots ────────────────────────── */

/*
 * Lines are plain data mapped to JSX — no components are defined inside the
 * render, which would remount the expression inputs and drop focus per keystroke.
 */

type PreviewLine =
  | { key: string; kind: 'static'; content: ReactNode }
  | { key: string; kind: 'expr'; value: string; clause: 'using' | 'with check'; onChange: (v: string) => void }

function SqlPreview({
  name,
  schema,
  table,
  behavior,
  command,
  roleStr,
  usingExpr,
  checkExpr,
  onUsing,
  onCheck,
}: {
  name: string
  schema: string
  table: string
  behavior: string
  command: Cmd
  roleStr: string
  /** `null` means the clause is not applicable for this command. */
  usingExpr: string | null
  checkExpr: string | null
  onUsing: (v: string) => void
  onCheck: (v: string) => void
}) {
  const kw = (s: string) => <span className="text-info">{s}</span>
  const lastIsUsing = usingExpr !== null && checkExpr === null

  const lines: PreviewLine[] = [
    {
      key: 'create',
      kind: 'static',
      content: (
        <>
          {kw('create policy')} <span className="text-warning">"{name || 'policy_name'}"</span>
        </>
      ),
    },
    { key: 'on', kind: 'static', content: <>{kw('on')} "{schema}"."{table}"</> },
    { key: 'as', kind: 'static', content: <>{kw('as')} {behavior}</> },
    { key: 'for', kind: 'static', content: <>{kw('for')} {command}</> },
    {
      key: 'to',
      kind: 'static',
      content: (
        <>
          {kw('to')} {roleStr}
          {usingExpr === null && checkExpr === null ? ';' : ''}
        </>
      ),
    },
  ]
  if (usingExpr !== null) {
    lines.push(
      { key: 'using-open', kind: 'static', content: <>{kw('using')} (</> },
      { key: 'using-expr', kind: 'expr', value: usingExpr, clause: 'using', onChange: onUsing },
      { key: 'using-close', kind: 'static', content: <>{lastIsUsing ? ');' : ')'}</> }
    )
  }
  if (checkExpr !== null) {
    lines.push(
      { key: 'check-open', kind: 'static', content: <>{kw('with check')} (</> },
      { key: 'check-expr', kind: 'expr', value: checkExpr, clause: 'with check', onChange: onCheck },
      { key: 'check-close', kind: 'static', content: <>);</> }
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-code font-mono text-[13px]">
      <p className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
        <Lock size={10} /> Use options above to edit
      </p>
      <div className="px-1 py-2">
        {lines.map((l, i) => (
          <div key={l.key} className="flex leading-6">
            <span className="w-8 shrink-0 select-none pr-3 text-right text-muted-foreground/60">{i + 1}</span>
            {l.kind === 'static' ? (
              <span className="whitespace-pre">{l.content}</span>
            ) : (
              <input
                value={l.value}
                onChange={(e) => l.onChange(e.target.value)}
                placeholder={`-- Provide a SQL expression for the ${l.clause} statement`}
                spellCheck={false}
                className="min-w-0 flex-1 border-b border-dashed border-input bg-transparent pr-2 font-mono text-brand placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
