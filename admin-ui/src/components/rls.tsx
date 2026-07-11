import { AlertTriangle, Lock, LockOpen, Plus, ShieldCheck, ShieldOff, ShieldPlus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Badge, Button, CodeView, ConfirmDialog, Dialog, Popover, Sheet, SheetClose, Spinner, Switch, toast } from './ui'
import { PolicyEditorSheet, type PolicyDraft } from './policy-editor'

/** Normalize a pg_policies row into the editor's draft shape. */
export function policyToDraft(p: {
  name: string
  cmd: string
  permissive: string
  roles: string[] | string
  using_expr: string | null
  with_check: string | null
}): PolicyDraft {
  return {
    name: p.name,
    command: (p.cmd?.toUpperCase() ?? 'ALL') as PolicyDraft['command'],
    behavior: String(p.permissive).toUpperCase() === 'RESTRICTIVE' ? 'RESTRICTIVE' : 'PERMISSIVE',
    roles: Array.isArray(p.roles)
      ? p.roles
      : String(p.roles)
          .replace(/[{}]/g, '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    using: p.using_expr,
    check: p.with_check,
  }
}

interface Policy {
  schema: string
  table: string
  name: string
  cmd: string
  permissive: string
  roles: string[] | string
  using_expr: string | null
  with_check: string | null
}

interface RlsState {
  enabled: boolean
  policies: Policy[]
}

const esc = (s: string) => s.replace(/'/g, "''")
const qual = (schema: string, table: string) => `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`

async function fetchRlsState(table: string, schema: string): Promise<RlsState> {
  const res = await api.sql(
    `select c.relrowsecurity as enabled
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = '${esc(schema)}' and c.relname = '${esc(table)}' and c.relkind = 'r'`
  )
  const enabled = res.ok ? Boolean(res.rows?.[0]?.enabled) : false
  const policies = ((await api.policies(schema)) as Policy[]).filter((p) => p.table === table)
  return { enabled, policies }
}

/**
 * Toolbar button showing an RLS status dot that opens the policies sheet.
 *
 * @param props.table - Table whose RLS status is shown.
 * @param props.schema - Schema the table belongs to.
 * @param props.refreshKey - Changing value forces a status refetch.
 * @param props.onChanged - Called when RLS or policies change via the sheet.
 */
export function RlsControls({
  table,
  schema = 'public',
  refreshKey,
  onChanged,
}: {
  table: string
  schema?: string
  refreshKey?: unknown
  onChanged?: () => void
}) {
  const [state, setState] = useState<RlsState | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetchRlsState(table, schema).then(setState, () => setState(null))
  }, [table, schema])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const n = state?.policies.length ?? 0
  const warn = state?.enabled && n === 0

  return (
    <>
      <Button
        variant="outline"
        size="xs"
        onClick={() => setOpen(true)}
        title={
          !state
            ? undefined
            : !state.enabled
              ? 'RLS is disabled — the API exposes all rows to every role'
              : warn
                ? 'RLS is enabled for this table, but no policies are set. Select queries may return 0 results.'
                : `${n} ${n === 1 ? 'policy' : 'policies'} active`
        }
      >
        <ShieldPlus size={12} />
        Add RLS policy
        {state && (
          <span className={'size-1.5 rounded-full ' + (!state.enabled ? 'bg-destructive' : warn ? 'bg-warning' : 'bg-brand')} />
        )}
      </Button>

      {open && (
        <RlsPoliciesSheet
          table={table}
          schema={schema}
          onClose={() => setOpen(false)}
          onChanged={() => {
            load()
            onChanged?.()
          }}
        />
      )}
    </>
  )
}

/**
 * Toolbar button and sheet for toggling a view's `security_invoker` option.
 * When on, the view runs with the caller's permissions and their RLS on the
 * underlying tables applies through it; when off, it runs as the owner and
 * bypasses that RLS.
 *
 * @param props.view - View whose security mode is managed.
 * @param props.schema - Schema the view belongs to.
 * @param props.refreshKey - Changing value forces a status refetch.
 * @param props.onChanged - Called when the security mode changes.
 */
export function ViewSecurityControls({
  view,
  schema = 'public',
  refreshKey,
  onChanged,
}: {
  view: string
  schema?: string
  refreshKey?: unknown
  onChanged?: () => void
}) {
  const [state, setState] = useState<{ invoker: boolean; def: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [fixing, setFixing] = useState(false)
  const [reverting, setReverting] = useState(false)

  const load = useCallback(() => {
    api
      .sql(
        `select coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as invoker,
                pg_get_viewdef(c.oid, true) as def
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = '${esc(schema)}' and c.relname = '${esc(view)}' and c.relkind = 'v'`
      )
      .then(
        (res) =>
          setState(res.ok && res.rows?.[0] ? { invoker: Boolean(res.rows[0].invoker), def: String(res.rows[0].def ?? '') } : null),
        () => setState(null)
      )
  }, [view, schema])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function apply(on: boolean) {
    const res = await api.sql(`alter view ${qual(schema, view)} set (security_invoker = ${on ? 'on' : 'off'})`)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to change view security')
      return
    }
    toast.success(on ? `${view} now runs with the caller's permissions` : `${view} now runs with the owner's permissions`)
    setFixing(false)
    setOpen(false)
    load()
    onChanged?.()
  }

  const invoker = state?.invoker ?? null
  const viewSql = (withInvoker: boolean) =>
    `create view ${schema}.${view}${withInvoker ? '\nwith (security_invoker = on)' : ''} as\n${(state?.def ?? '…').trim()}`
  /** both diff panels share the taller side's height so they sit flush */
  const diffLines = Math.max(viewSql(true).split('\n').length, 6) + 1

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        align="end"
        className="w-120 p-4"
        trigger={
          <Button
            variant="outline"
            size="xs"
            className={invoker === false ? 'border-warning/50 bg-warning/10 text-warning hover:border-warning hover:bg-warning/15' : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            {invoker === false ? <Lock size={12} /> : <LockOpen size={12} />}
            {invoker === false ? 'Security Definer view' : 'Security Invoker view'}
            {invoker === true && <span className="size-1.5 rounded-full bg-brand" />}
          </Button>
        }
      >
        <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
          {invoker === false ? <Lock size={13} className="text-warning" /> : <ShieldCheck size={13} className="text-brand" />}
          {invoker === false ? 'Secure your view' : 'This view is secured'}
        </p>
        {invoker === false ? (
          <>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
              This view is defined with the Security Definer property, giving it the permissions of the view's creator (postgres),
              rather than the permissions of the querying user.
            </p>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
              Since this view is in the <code className="text-foreground/80">{schema}</code> schema, it is accessible via your
              project's APIs — Row Level Security on the tables it reads is bypassed through it.
            </p>
            <div className="mt-4">
              <Button onClick={() => setFixing(true)}>Autofix</Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
              This view runs with <code className="text-muted-foreground">security_invoker=on</code> — it executes with the querying
              user's permissions, so Row Level Security on the underlying tables applies through it.
            </p>
            <button
              className="mt-3 text-[11px] text-muted-foreground/70 underline-offset-2 hover:text-destructive hover:underline"
              onClick={() => setReverting(true)}
            >
              Switch back to security definer…
            </button>
          </>
        )}
      </Popover>

      {fixing && (
        <Dialog open onClose={() => setFixing(false)} title="Confirm autofixing view security" width="w-235">
          <div className="px-1 pt-1">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Setting <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">security_invoker=on</code>{' '}
              ensures the view runs with the permissions of the querying user, reducing the risk of unintended data exposure.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              {(
                [
                  ['Existing query', viewSql(false)],
                  ['Updated query', viewSql(true)],
                ] as const
              ).map(([label, sql]) => (
                <div key={label} className="overflow-hidden rounded-md border border-border bg-code">
                  <div className="border-b border-border bg-card px-4 py-2.5 font-mono text-[12px] font-medium text-foreground">
                    {label}
                  </div>
                  <div className="px-2 py-3">
                    <CodeView value={sql} lang="sql" readOnly minLines={diffLines} maxLines={diffLines} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="-mx-4 -mb-4 mt-5 flex gap-3 border-t border-border px-4 py-3.5">
            <Button variant="outline" className="h-9 flex-1" onClick={() => setFixing(false)}>
              Cancel
            </Button>
            <Button className="h-9 flex-1" autoFocus onClick={() => void apply(true)}>
              Confirm
            </Button>
          </div>
        </Dialog>
      )}

      {reverting && (
        <ConfirmDialog
          open
          danger
          title={`Run "${view}" as its owner?`}
          description="RLS on the underlying tables will be bypassed through this view — every role can read all rows the owner can."
          confirmLabel="Switch to definer"
          onConfirm={() => {
            setReverting(false)
            void apply(false)
          }}
          onClose={() => setReverting(false)}
        />
      )}
    </>
  )
}

/**
 * Row Level Security sheet for a table: toggle RLS, list and drop policies,
 * and create new ones via the policy editor.
 *
 * @param props.table - Table to manage RLS for.
 * @param props.schema - Schema the table belongs to.
 * @param props.onClose - Called to dismiss the sheet.
 * @param props.onChanged - Called after any RLS or policy change.
 */
export function RlsPoliciesSheet({
  table,
  schema = 'public',
  onClose,
  onChanged,
}: {
  table: string
  schema?: string
  onClose: () => void
  onChanged?: () => void
}) {
  const [state, setState] = useState<RlsState | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingPolicy, setEditingPolicy] = useState<Policy | null>(null)
  const [confirmingDisable, setConfirmingDisable] = useState(false)
  const [droppingPolicy, setDroppingPolicy] = useState<Policy | null>(null)

  const load = useCallback(async () => {
    try {
      setState(await fetchRlsState(table, schema))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [table, schema])

  useEffect(() => {
    void load()
  }, [load])

  async function applyRls(on: boolean) {
    const res = await api.sql(`alter table ${qual(schema, table)} ${on ? 'enable' : 'disable'} row level security`)
    if (!res.ok) {
      toast.error(res.error ?? 'Failed to change RLS')
      return
    }
    toast.success(`RLS ${on ? 'enabled' : 'disabled'} on ${table}`)
    await load()
    onChanged?.()
  }

  async function dropPolicy(p: Policy) {
    try {
      await api.dropPolicy(table, p.name, schema)
      toast.success(`Dropped policy ${p.name}`)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-[560px]"
      title={
        <span>
          Row Level Security — <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{table}</code>
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
      {!state ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3.5">
            {state.enabled ? <ShieldCheck size={16} className="text-brand" /> : <ShieldOff size={16} className="text-destructive" />}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium text-foreground">Enable Row Level Security</p>
              <p className="text-[11px] text-muted-foreground/80">
                {state.enabled
                  ? 'Rows are only visible to roles a policy grants access to. The service_role always bypasses RLS.'
                  : 'RLS is disabled — the API exposes all rows to every role, including anon.'}
              </p>
            </div>
            <Switch checked={state.enabled} onChange={(on) => (on ? void applyRls(true) : setConfirmingDisable(true))} />
          </div>

          {state.enabled && state.policies.length === 0 && (
            <div className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              <AlertTriangle size={13} className="mt-px shrink-0" />
              RLS is enabled for this table, but no policies are set. Select queries by anon/authenticated will return 0 results.
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Policies <span className="text-muted-foreground/60">{state.policies.length}</span>
              </p>
              <Button size="xs" onClick={() => setCreating(true)}>
                <Plus size={12} /> Create policy
              </Button>
            </div>
            <div className="space-y-2">
              {state.policies.map((p) => (
                <div
                  key={p.name}
                  className="cursor-pointer rounded-md border border-border bg-card p-3 transition-colors hover:border-muted-foreground/60"
                  title="Edit policy"
                  onClick={() => setEditingPolicy(p)}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] text-foreground">{p.name}</span>
                    <Badge variant="blue">{p.cmd}</Badge>
                    {String(p.permissive).toUpperCase() !== 'PERMISSIVE' && <Badge variant="red">restrictive</Badge>}
                    <Badge variant="neutral">{Array.isArray(p.roles) ? p.roles.join(', ') : String(p.roles)}</Badge>
                    <button
                      className="ml-auto p-1 text-muted-foreground/80 hover:text-destructive"
                      title="Drop policy"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDroppingPolicy(p)
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {p.using_expr && (
                    <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground/80" title={p.using_expr}>
                      using ({p.using_expr})
                    </p>
                  )}
                  {p.with_check && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80" title={p.with_check}>
                      with check ({p.with_check})
                    </p>
                  )}
                </div>
              ))}
              {state.policies.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground/60">
                  No policies on this table yet. Start from a template →{' '}
                  <button className="text-brand hover:underline" onClick={() => setCreating(true)}>
                    Create policy
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {creating && (
        <PolicyEditorSheet
          table={table}
          schema={schema}
          onClose={() => setCreating(false)}
          onCreated={async () => {
            await load()
            onChanged?.()
          }}
        />
      )}
      {editingPolicy && (
        <PolicyEditorSheet
          table={table}
          schema={schema}
          existing={policyToDraft(editingPolicy)}
          onClose={() => setEditingPolicy(null)}
          onCreated={async () => {
            await load()
            onChanged?.()
          }}
        />
      )}
      {confirmingDisable && (
        <ConfirmDialog
          open
          danger
          title={`Disable RLS on "${table}"?`}
          description="Every role — including anon — will be able to read and write all rows through the API."
          confirmLabel="Disable RLS"
          onConfirm={() => void applyRls(false)}
          onClose={() => setConfirmingDisable(false)}
        />
      )}
      {droppingPolicy && (
        <ConfirmDialog
          open
          danger
          title={`Drop policy "${droppingPolicy.name}"?`}
          description="Access rules for this table change immediately."
          confirmLabel="Drop policy"
          onConfirm={() => void dropPolicy(droppingPolicy)}
          onClose={() => setDroppingPolicy(null)}
        />
      )}
    </Sheet>
  )
}
