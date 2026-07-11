import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { PolicyEditorSheet } from '../../components/policy-editor'
import { policyToDraft } from '../../components/rls'
import { Badge, Button, ConfirmDialog, Empty, Spinner, toast } from '../../components/ui'

interface Policy {
  table: string
  name: string
  cmd: string
  permissive: string
  roles: string[] | string
  using_expr: string | null
  with_check: string | null
}

/**
 * RLS policies on storage.objects — they gate every object operation, exactly
 * like table policies gate rows. Full lifecycle: create, click-to-edit, drop,
 * live-synced, sharing the same policy editor as the rest of the studio.
 * Policies mentioning the current bucket are grouped first.
 */
export function BucketPolicies({ bucket }: { bucket?: string }) {
  const [policies, setPolicies] = useState<Policy[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Policy | null>(null)
  const [dropping, setDropping] = useState<Policy | null>(null)

  const load = useCallback(() => {
    api.policies('storage').then(
      (p) => setPolicies((p as Policy[]).filter((x) => x.table === 'objects')),
      () => setPolicies([])
    )
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000) // live sync with SQL-editor DDL
    return () => clearInterval(t)
  }, [load])

  async function drop(p: Policy) {
    try {
      await api.dropPolicy('objects', p.name, 'storage')
      toast.success(`Dropped policy ${p.name}`)
      load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (policies === null) return <Spinner />

  const mentions = (p: Policy) => `${p.using_expr ?? ''} ${p.with_check ?? ''}`.includes(`'${bucket}'`)
  const forBucket = bucket ? policies.filter(mentions) : []
  const others = bucket ? policies.filter((p) => !mentions(p)) : policies

  const card = (p: Policy) => (
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
  )

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <div className="flex max-w-2xl items-start justify-between gap-4">
        <p className="text-xs text-muted-foreground/80">
          Object access is controlled by RLS policies on <code className="text-muted-foreground">storage.objects</code>. The
          service_role (this studio) bypasses them; your app's anon/authenticated requests do not. Scope a policy to a bucket with{' '}
          <code className="text-muted-foreground">bucket_id = '{bucket ?? 'name'}'</code>.
        </p>
        <Button size="xs" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus size={12} /> New policy
        </Button>
      </div>

      <div className="mt-4 max-w-2xl space-y-5">
        {bucket && (
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Policies for {bucket} <span className="text-muted-foreground/40">{forBucket.length}</span>
            </p>
            <div className="space-y-2">
              {forBucket.map(card)}
              {forBucket.length === 0 && (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-center text-xs text-muted-foreground/60">
                  No policies mention this bucket yet.
                </p>
              )}
            </div>
          </div>
        )}
        <div>
          {bucket && (
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Other policies on storage.objects <span className="text-muted-foreground/40">{others.length}</span>
            </p>
          )}
          <div className="space-y-2">
            {others.map(card)}
            {policies.length === 0 && (
              <Empty>
                No policies on storage.objects — only the service_role can access objects in private buckets. Create one to open
                access up.
              </Empty>
            )}
          </div>
        </div>
      </div>

      {creating && (
        <PolicyEditorSheet table="objects" schema="storage" onClose={() => setCreating(false)} onCreated={async () => load()} />
      )}
      {editing && (
        <PolicyEditorSheet
          table="objects"
          schema="storage"
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
          description="Object access rules change immediately."
          confirmLabel="Drop policy"
          onConfirm={() => void drop(dropping)}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}
