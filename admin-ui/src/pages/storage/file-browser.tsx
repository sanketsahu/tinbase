import { ChevronRight, File, Folder, Home, Link2, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { Button, Checkbox, ConfirmDialog, Empty, ResizablePanel, Spinner, Table, Td, Th, THead, Time, toast, TRow } from '../../components/ui'
import { copyText } from '../../lib/clipboard'
import { apiUrl } from '../../lib/snippet'
import type { Bucket } from './index'

interface Entry {
  name: string
  id: string | null
  updated_at?: string
  metadata?: { size?: number; mimetype?: string } | null
}

const isFolder = (e: Entry) => e.id === null && !e.metadata

function fmtSize(bytes?: number): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Folder-aware object browser: breadcrumbs, drag-drop upload, multi-select
 * delete, copy public/signed URLs, and inline image preview.
 */
export function FileBrowser({ bucket }: { bucket: Bucket }) {
  const [prefix, setPrefix] = useState('')
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Entry | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setEntries((await api.listObjects(bucket.id, prefix)) as Entry[])
    } catch (e) {
      toast.error((e as Error).message)
      setEntries([])
    }
  }, [bucket.id, prefix])

  useEffect(() => {
    setSelected(new Set())
    setPreview(null)
    void load()
  }, [load])

  const pathOf = (e: Entry) => (prefix ? `${prefix}/${e.name}` : e.name)

  async function upload(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      try {
        await api.uploadObject(bucket.id, prefix ? `${prefix}/${file.name}` : file.name, file)
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`)
      }
    }
    toast.success(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`)
    await load()
  }

  async function removeSelected() {
    try {
      await api.removeObjects(bucket.id, [...selected])
      toast.success(`Deleted ${selected.size} object${selected.size === 1 ? '' : 's'}`)
      setSelected(new Set())
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function copyUrl(e: Entry) {
    const path = pathOf(e)
    if (bucket.public) {
      await copyText(`${apiUrl()}/storage/v1/object/public/${bucket.id}/${path}`, 'Public URL')
    } else {
      try {
        const url = await api.signUrl(bucket.id, path, 3600)
        await copyText(url, 'Signed URL (1h)')
      } catch (err) {
        toast.error((err as Error).message)
      }
    }
  }

  if (entries === null) return <Spinner />

  const crumbs = prefix ? prefix.split('/') : []
  const files = entries.filter((e) => !isFolder(e))
  const fileKeys = files.map(pathOf)
  const allChecked = fileKeys.length > 0 && fileKeys.every((k) => selected.has(k))

  return (
    <div
      className="relative flex h-full min-h-0"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (e.dataTransfer.files.length) void upload(e.dataTransfer.files)
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        {/* breadcrumbs + actions */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 text-[13px]">
          <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setPrefix('')}>
            <Home size={12} /> {bucket.id}
          </button>
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight size={11} className="text-muted-foreground/60" />
              <button
                className="font-mono text-muted-foreground hover:text-foreground"
                onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/'))}
              >
                {c}
              </button>
            </span>
          ))}
          <div className="ml-auto flex items-center gap-1.5">
            {selected.size > 0 && (
              <Button variant="dangerSolid" size="xs" onClick={() => setConfirmingDelete(true)}>
                <Trash2 size={12} /> Delete {selected.size}
              </Button>
            )}
            <Button variant="ghost" size="iconXs" title="Refresh" onClick={() => void load()}>
              <RefreshCw size={13} />
            </Button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
            <Button size="xs" onClick={() => fileRef.current?.click()}>
              <Upload size={12} /> Upload
            </Button>
          </div>
        </div>

        {/* listing */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <THead>
              <tr>
                <Th className="w-10">
                  <Checkbox
                    checked={allChecked}
                    indeterminate={!allChecked && fileKeys.some((k) => selected.has(k))}
                    disabled={fileKeys.length === 0}
                    onChange={(c) => setSelected(c ? new Set(fileKeys) : new Set())}
                  />
                </Th>
                <Th>Name</Th>
                <Th>Size</Th>
                <Th>Type</Th>
                <Th>Modified</Th>
                <Th className="w-16" />
              </tr>
            </THead>
            <tbody>
              {entries.map((e) => {
                const folder = isFolder(e)
                const key = pathOf(e)
                return (
                  <TRow
                    key={e.name}
                    className="cursor-pointer"
                    onClick={() => (folder ? setPrefix(key) : setPreview(e))}
                  >
                    <Td onClick={(ev) => ev.stopPropagation()}>
                      {!folder && (
                        <Checkbox
                          checked={selected.has(key)}
                          onChange={(c) =>
                            setSelected((cur) => {
                              const next = new Set(cur)
                              if (c) next.add(key)
                              else next.delete(key)
                              return next
                            })
                          }
                        />
                      )}
                    </Td>
                    <Td className="font-mono text-foreground/90">
                      <span className="flex items-center gap-2">
                        {folder ? <Folder size={13} className="text-info" /> : <File size={13} className="text-muted-foreground/70" />}
                        {e.name}
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">{folder ? '—' : fmtSize(e.metadata?.size)}</Td>
                    <Td className="text-muted-foreground">{folder ? 'folder' : (e.metadata?.mimetype ?? '—')}</Td>
                    <Td className="text-muted-foreground">
                      <Time value={e.updated_at} />
                    </Td>
                    <Td onClick={(ev) => ev.stopPropagation()}>
                      {!folder && (
                        <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100">
                          <button
                            className="p-1 text-muted-foreground/80 hover:text-foreground"
                            title={bucket.public ? 'Copy public URL' : 'Copy signed URL (1h)'}
                            onClick={() => void copyUrl(e)}
                          >
                            <Link2 size={13} />
                          </button>
                          <button
                            className="p-1 text-muted-foreground/80 hover:text-destructive"
                            title="Delete"
                            onClick={() => {
                              setSelected(new Set([key]))
                              setConfirmingDelete(true)
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </Table>
          {entries.length === 0 && <Empty>Empty{prefix ? ' folder' : ' bucket'} — drop files here or hit Upload.</Empty>}
        </div>
      </div>

      {/* preview panel */}
      {preview && <PreviewPanel bucket={bucket} path={pathOf(preview)} entry={preview} onClose={() => setPreview(null)} onCopyUrl={() => void copyUrl(preview)} />}

      {/* drag overlay */}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-brand bg-brand/5">
          <p className="rounded-md bg-popover px-4 py-2 text-sm text-foreground shadow-lg">Drop to upload{prefix ? ` into ${prefix}/` : ''}</p>
        </div>
      )}

      {confirmingDelete && (
        <ConfirmDialog
          open
          danger
          title={`Delete ${selected.size} object${selected.size === 1 ? '' : 's'}?`}
          description="Objects are permanently removed from the bucket."
          confirmLabel="Delete"
          onConfirm={() => void removeSelected()}
          onClose={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  )
}

function PreviewPanel({
  bucket,
  path,
  entry,
  onClose,
  onCopyUrl,
}: {
  bucket: Bucket
  path: string
  entry: Entry
  onClose: () => void
  onCopyUrl: () => void
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const mime = entry.metadata?.mimetype ?? ''
  const isImage = mime.startsWith('image/')
  const isText = mime.startsWith('text/') || mime === 'application/json'
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let url: string | null = null
    setBlobUrl(null)
    setText(null)
    setFailed(false)
    if (!isImage && !isText) return
    api.downloadObject(bucket.id, path).then(
      async (blob) => {
        if (isImage) {
          url = URL.createObjectURL(blob)
          setBlobUrl(url)
        } else {
          setText((await blob.text()).slice(0, 4000))
        }
      },
      () => setFailed(true)
    )
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [bucket.id, path, isImage, isText])

  return (
    <ResizablePanel id="storage-preview" side="right" defaultSize={320} min={260} max={560} className="flex flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="truncate font-mono text-[13px] text-foreground">{entry.name}</span>
        <button className="text-muted-foreground/80 hover:text-foreground" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isImage &&
          (blobUrl ? (
            <img src={blobUrl} alt={entry.name} className="max-h-64 w-full rounded-md border border-border object-contain" />
          ) : failed ? (
            <p className="text-xs text-destructive">Preview failed.</p>
          ) : (
            <div className="h-40 animate-pulse rounded-md bg-accent" />
          ))}
        {isText && text !== null && (
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-code p-2 font-mono text-[11px] text-foreground/80">{text}</pre>
        )}
        {!isImage && !isText && <p className="text-xs text-muted-foreground/80">No inline preview for {mime || 'this type'}.</p>}

        <div className="mt-4 space-y-1.5 text-[13px]">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Size</span>
            <span className="font-mono text-foreground/90">{fmtSize(entry.metadata?.size)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Type</span>
            <span className="truncate font-mono text-foreground/90">{mime || '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Path</span>
            <span className="truncate font-mono text-foreground/90" title={path}>
              {path}
            </span>
          </div>
        </div>

        <Button variant="outline" size="xs" className="mt-4 w-full" onClick={onCopyUrl}>
          <Link2 size={12} /> {bucket.public ? 'Copy public URL' : 'Copy signed URL (1h)'}
        </Button>
      </div>
    </ResizablePanel>
  )
}
