import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { PolicyEditorSheet } from '../../components/policy-editor'
import { policyToDraft } from '../../components/rls'
import { Badge, Button, ConfirmDialog, Empty, Spinner, toast } from '../../components/ui'
import { CatalogHeader, useDbSchema } from './shared'

interface Policy {
  table: string
  name: string
  cmd: string
  permissive: string
  roles: string[] | string
  using_expr: string | null
  with_check: string | null
}

/** All RLS policies grouped by table, with create (full editor) and drop. */
export function PoliciesSection() {
  const [schema] = useDbSchema()
  const [policies, setPolicies] = useState<Policy[] | null>(null)
  const [tables, setTables] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [dropping, setDropping] = useState<Policy | null>(null)

  const load = useCallback(() => {
    Promise.all([api.policies(schema), api.tables(schema)]).then(
      ([p, t]) => {
        setPolicies(p as Policy[])
        // policies attach to tables only — views can't have RLS
        setTables(t.filter((x) => !x.isView).map((x) => x.name))
      },
      () => setPolicies([])
    )
  }, [schema])

  useEffect(() => {
    void load()
    // live sync — policies created/dropped from the table editor's RLS sheet
    // or the SQL editor show up here without a manual refresh
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  async function drop(p: Policy) {
    try {
      await api.dropPolicy(p.table, p.name)
      toast.success(`Dropped policy ${p.name}`)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (policies === null) return <Spinner />

  const visible = policies.filter((p) => (p.table + p.name).toLowerCase().includes(search.toLowerCase()))
  const byTable = new Map<string, Policy[]>()
  for (const p of visible) {
    if (!byTable.has(p.table)) byTable.set(p.table, [])
    byTable.get(p.table)!.push(p)
  }

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Policies"
        description="Row Level Security policies across every table — who can see and write which rows."
        search={search}
        onSearch={setSearch}
        onRefresh={load}
        schemaPicker
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> New policy
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
        {[...byTable].map(([table, ps]) => (
          <div key={table}>
            <div className="mb-1.5 flex items-center gap-2">
              <ShieldCheck size={13} className="text-brand" />
              <span className="font-mono text-[13px] text-foreground/90">{table}</span>
              <span className="text-[11px] text-muted-foreground/60">
                {ps.length} {ps.length === 1 ? 'policy' : 'policies'}
              </span>
            </div>
            <div className="space-y-2">
              {ps.map((p) => (
                <div
                  key={p.name}
                  className="cursor-pointer rounded-md border border-border bg-card p-3 transition-colors hover:border-muted-foreground/60"
                  title="Edit policy"
                  onClick={() => setEditing(p)}
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
                        setDropping(p)
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
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <Empty>{policies.length === 0 ? 'No policies yet. Create one to start restricting access.' : 'No match.'}</Empty>
        )}
      </div>

      {creating && (
        <PolicyEditorSheet tables={tables} schema={schema} onClose={() => setCreating(false)} onCreated={async () => load()} />
      )}
      {editing && (
        <PolicyEditorSheet
          table={editing.table}
          schema={schema}
          existing={policyToDraft(editing)}
          onClose={() => setEditing(null)}
          onCreated={async () => load()}
        />
      )}
      {dropping && (
        <ConfirmDialog
          open
          danger
          title={`Drop policy "${dropping.name}"?`}
          description={`Access rules for "${dropping.table}" change immediately.`}
          confirmLabel="Drop policy"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

