import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Button, ConfirmDialog, Empty, Input, Label, Sheet, SheetClose, Spinner, Switch, toast } from '../../components/ui'
import { CatalogHeader, quoteIdent } from './shared'

interface Role {
  name: string
  oid: number
  super: boolean
  login: boolean
  createdb: boolean
  createrole: boolean
  replication: boolean
  bypassrls: boolean
  connlimit: number
  connections: number
}

/** Roles created by tinbase's bootstrap — shown grouped and locked. */
const MANAGED_ROLES = new Set(['postgres', 'anon', 'authenticated', 'authenticator', 'service_role'])

/** Privilege toggles, in Supabase's order. `superuser` can't be granted from the dashboard. */
const PRIVS = [
  { key: 'login', label: 'User can login', sql: (on: boolean) => (on ? 'login' : 'nologin') },
  { key: 'createrole', label: 'User can create roles', sql: (on: boolean) => (on ? 'createrole' : 'nocreaterole') },
  { key: 'createdb', label: 'User can create databases', sql: (on: boolean) => (on ? 'createdb' : 'nocreatedb') },
  { key: 'bypassrls', label: 'User bypasses every row level security policy', sql: (on: boolean) => (on ? 'bypassrls' : 'nobypassrls') },
  {
    key: 'replication',
    label: 'User can initiate streaming replication and put the system in and out of backup mode',
    sql: (on: boolean) => (on ? 'replication' : 'noreplication'),
  },
] as const

/** Database roles: grouped managed vs custom, expandable privileges, create/edit/drop. */
export function RolesSection() {
  const [rows, setRows] = useState<Role[] | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [dropping, setDropping] = useState<Role | null>(null)

  const load = useCallback(async () => {
    const res = await api.sql(
      `select r.rolname as name, r.oid::int as oid, r.rolsuper as "super", r.rolcanlogin as login,
              r.rolcreatedb as createdb, r.rolcreaterole as createrole,
              r.rolreplication as replication, r.rolbypassrls as bypassrls,
              r.rolconnlimit as connlimit,
              coalesce((select count(*)::int from pg_stat_activity a where a.usename = r.rolname), 0) as connections
       from pg_roles r where r.rolname not like 'pg\\_%' order by r.rolname`
    )
    setRows(res.ok ? ((res.rows ?? []) as Role[]) : [])
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync
    return () => clearInterval(t)
  }, [load])

  async function setPriv(role: Role, priv: (typeof PRIVS)[number], on: boolean) {
    const res = await api.sql(`alter role ${quoteIdent(role.name)} ${priv.sql(on)}`)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to change privilege')
      return
    }
    toast.success(`${role.name}: ${priv.sql(on)}`)
    await load()
  }

  async function drop(role: Role) {
    const res = await api.sql(`drop role ${quoteIdent(role.name)}`)
    if (!res.ok) {
      toast.error(res.error ?? 'Drop failed — the role may still own objects or have grants')
      return
    }
    toast.success(`Dropped role ${role.name}`)
    await load()
  }

  if (rows === null) return <Spinner />
  const visible = rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
  const managedRoles = visible.filter((r) => MANAGED_ROLES.has(r.name))
  const customRoles = visible.filter((r) => !MANAGED_ROLES.has(r.name))
  const totalConnections = rows.reduce((n, r) => n + r.connections, 0)

  const renderRole = (r: Role, locked: boolean) => {
    const open = expanded === r.name
    return (
      <div key={r.name} className="border-b border-border/60 last:border-b-0">
        <button
          className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
          onClick={() => setExpanded(open ? null : r.name)}
        >
          {open ? <ChevronDown size={13} className="shrink-0 text-muted-foreground/60" /> : <ChevronRight size={13} className="shrink-0 text-muted-foreground/60" />}
          <span className="font-mono text-[13px] text-foreground">{r.name}</span>
          <span className="text-[11px] text-muted-foreground/60">(ID: {r.oid})</span>
          {r.super && <Badge variant="amber">superuser</Badge>}
          {['anon', 'authenticated', 'service_role'].includes(r.name) && <Badge variant="brand">api</Badge>}
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
            {r.connections > 0 && <span className="size-1.5 rounded-full bg-brand" />}
            {r.connections} connection{r.connections === 1 ? '' : 's'}
          </span>
          {!locked && (
            <span
              role="button"
              title="Drop role"
              className="rounded p-1 text-muted-foreground/70 hover:bg-muted hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                setDropping(r)
              }}
            >
              <Trash2 size={13} />
            </span>
          )}
        </button>
        {open && (
          <div className="space-y-3 px-11 pb-4 pt-1">
            {PRIVS.map((p) => (
              <label key={p.key} className={'flex items-center gap-3 text-[13px] text-foreground/85 ' + (locked ? 'opacity-70' : '')}>
                <Switch checked={Boolean(r[p.key])} disabled={locked} onChange={(on) => void setPriv(r, p, on)} />
                {p.label}
              </label>
            ))}
            <label className="flex items-center gap-3 text-[13px] text-foreground/85 opacity-70">
              <Switch checked={r.super} disabled />
              User is a Superuser <span className="text-[11px] text-muted-foreground/60">— cannot be granted via the dashboard</span>
            </label>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Roles"
        description="Manage access control to your database through users, groups, and permissions."
        search={search}
        onSearch={setSearch}
        onRefresh={() => void load()}
        filters={
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground/70">
            Active connections <span className="tabular-nums text-foreground/80">{totalConnections}</span>
          </span>
        }
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> Add role
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        <div>
          <div className="mb-1.5 flex items-center gap-2">
            <p className="text-[13px] text-foreground/90">Roles managed by tinbase</p>
            <Badge variant="brand">PROTECTED</Badge>
          </div>
          <div className="rounded-md border border-border bg-card">
            {managedRoles.map((r) => renderRole(r, true))}
            {managedRoles.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground/60">No match.</p>}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] text-foreground/90">Custom roles</p>
          <div className="rounded-md border border-border bg-card">
            {customRoles.map((r) => renderRole(r, false))}
            {customRoles.length === 0 && (
              <Empty>
                No custom roles yet —{' '}
                <button className="text-brand hover:underline" onClick={() => setCreating(true)}>
                  add one
                </button>
                .
              </Empty>
            )}
          </div>
        </div>
      </div>

      {creating && (
        <CreateRoleSheet
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
          title={`Drop role "${dropping.name}"?`}
          description="Grants and policies referencing this role will stop matching. Fails if the role still owns objects."
          confirmLabel="Drop role"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

function CreateRoleSheet({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [privs, setPrivs] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function create() {
    if (!name.trim()) return setErr('Role name is required.')
    setBusy(true)
    setErr('')
    const flags = PRIVS.map((p) => p.sql(Boolean(privs[p.key]))).join(' ')
    const res = await api.sql(`create role ${quoteIdent(name.trim())} ${flags}`)
    if (!res.ok) {
      setErr(res.error ?? 'Create failed')
      setBusy(false)
      return
    }
    toast.success(`Created role ${name.trim()}`)
    await onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-135"
      title="Create a new role"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create role'}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input mono value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label>Role privileges</Label>
          <div className="space-y-2.5">
            {PRIVS.map((p) => (
              <label key={p.key} className="flex items-center gap-3 text-[13px] text-foreground/85">
                <Switch checked={Boolean(privs[p.key])} onChange={(on) => setPrivs((cur) => ({ ...cur, [p.key]: on }))} />
                {p.label}
              </label>
            ))}
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-2 text-[12px] font-medium text-foreground/80">These privileges cannot be granted via the dashboard:</p>
            <label className="flex items-center gap-3 text-[13px] text-foreground/85 opacity-60">
              <Switch checked={false} disabled />
              User is a Superuser
            </label>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
