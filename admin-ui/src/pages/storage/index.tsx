import { FolderPlus, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, Input, Label, ResizablePanel, Spinner, Tabs, toast } from '../../components/ui'
import { navigate, useRoute } from '../../lib/router'
import { BucketPolicies } from './bucket-policies'
import { BucketSettings } from './bucket-settings'
import { FileBrowser } from './file-browser'

export interface Bucket {
  id: string
  name: string
  public: boolean
  file_size_limit?: number | null
  allowed_mime_types?: string[] | null
  created_at?: string
}

/** Storage: bucket rail + Files / Settings / Policies tabs per bucket. */
export function StoragePage() {
  const [buckets, setBuckets] = useState<Bucket[] | null>(null)
  const [tab, setTab] = useState('files')
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<Bucket | null>(null)

  const { section } = useRoute()

  const load = useCallback(async () => {
    try {
      const b = (await api.buckets()) as Bucket[]
      setBuckets(b)
      return b
    } catch {
      setBuckets([])
      return []
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (buckets === null) return <Spinner />

  const active = buckets.find((b) => b.id === section) ?? null

  // keep the URL honest: /_/storage/<bucket>
  if (!active && buckets.length > 0 && section === null) {
    navigate('storage', buckets[0].id, { replace: true })
  }

  async function del(b: Bucket) {
    try {
      await api.deleteBucket(b.id)
      toast.success(`Deleted bucket ${b.id}`)
      const next = await load()
      navigate('storage', next[0]?.id ?? null, { replace: true })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full">
      {/* bucket rail */}
      <ResizablePanel id="storage-rail" side="left" defaultSize={224} min={180} max={360} className="flex flex-col border-r border-border bg-card">
        <div className="px-4 pb-1 pt-4 text-sm font-semibold text-foreground">Storage</div>
        <div className="px-2 pb-2 pt-1">
          <Button variant="outline" size="xs" className="w-full" onClick={() => setCreating(true)}>
            <Plus size={12} /> New bucket
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {buckets.map((b) => (
            <button
              key={b.id}
              onClick={() => navigate('storage', b.id)}
              className={
                'mb-px flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ' +
                (active?.id === b.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')
              }
            >
              <span className="min-w-0 flex-1 truncate font-mono">{b.id}</span>
              {b.public && <Badge variant="brand">public</Badge>}
            </button>
          ))}
          {buckets.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">No buckets yet.</p>}
        </div>
      </ResizablePanel>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <div className="shrink-0 px-6 pt-5">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-lg font-semibold text-foreground">{active.id}</h1>
                {active.public && <Badge variant="brand">public</Badge>}
              </div>
              <div className="mt-3">
                <Tabs
                  tabs={[
                    { id: 'files', label: 'Files' },
                    { id: 'settings', label: 'Settings' },
                    { id: 'policies', label: 'Policies' },
                  ]}
                  active={tab}
                  onSelect={setTab}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'files' && <FileBrowser bucket={active} />}
              {tab === 'settings' && <BucketSettings bucket={active} onDelete={() => setDeleting(active)} />}
              {tab === 'policies' && <BucketPolicies bucket={active.id} />}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="rounded-lg border border-dashed border-border px-16 py-12 text-center">
              <FolderPlus size={22} className="mx-auto text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">Create a file bucket</p>
              <p className="mt-1 text-xs text-muted-foreground/80">Store images, videos, documents, and any other file type.</p>
              <Button size="xs" className="mt-4" onClick={() => setCreating(true)}>
                <Plus size={12} /> New bucket
              </Button>
            </div>
          </div>
        )}
      </div>

      {creating && (
        <CreateBucketDialog
          onClose={() => setCreating(false)}
          onDone={async (id) => {
            setCreating(false)
            await load()
            navigate('storage', id, { replace: true })
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          danger
          title={`Delete bucket "${deleting.id}"?`}
          description="The bucket must be empty before it can be deleted."
          confirmLabel="Delete bucket"
          onConfirm={() => void del(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

function CreateBucketDialog({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [pub, setPub] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await api.createBucket({ id: name, name, public: pub })
      toast.success(`Created bucket ${name}`)
      await onDone(name)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="New bucket">
      <div className="space-y-3">
        <div>
          <Label>Name — lowercase, no spaces</Label>
          <Input mono value={name} autoFocus placeholder="avatars" onChange={(e) => setName(e.target.value.toLowerCase())} onKeyDown={(e) => e.key === 'Enter' && name && void submit()} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground/80">
          <Checkbox checked={pub} onChange={setPub} />
          Public bucket — objects readable without auth
        </label>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name}>
            {busy ? 'Creating…' : 'Create bucket'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
