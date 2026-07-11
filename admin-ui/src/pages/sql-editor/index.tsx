import ace from 'ace-builds'
import { Heart, History, MoreVertical, Pencil, Play, Plus, Search, Trash2, WandSparkles, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { RolePicker, type RolePreview } from '../../components/role-picker'
import {
  Button,
  CodeEditor,
  ConfirmDialog,
  Dialog,
  Empty,
  Input,
  Kbd,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Popover,
  ResizablePanel,
  Select,
  Time,
  toast,
} from '../../components/ui'
import { ResultsPanel, type SqlResult } from './results'
import {
  applyLimit,
  formatSql,
  loadHistory,
  loadQueries,
  loadTabs,
  newId,
  pushHistory,
  clearHistory,
  saveQueries,
  saveTabs,
  titleFor,
  type HistoryEntry,
  type SavedQuery,
  type SqlTab,
} from './store'

/* ── schema-aware autocomplete (registered once) ── */
let completerRegistered = false
function registerSchemaCompleter(getWords: () => { caption: string; value: string; meta: string }[]) {
  if (completerRegistered) return
  completerRegistered = true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const langTools = (ace as any).require('ace/ext/language_tools')
  langTools.addCompleter({
    getCompletions: (_e: unknown, _s: unknown, _p: unknown, _x: unknown, cb: (err: null, list: unknown[]) => void) => {
      cb(null, getWords().map((w) => ({ ...w, score: 500 })))
    },
  })
}

/**
 * Full SQL editor: saved queries (favorites, rename, delete), tabs with
 * autosave, run-as-role, result limit, history, schema-aware autocomplete,
 * and a results grid with export.
 */
export function SqlEditor() {
  /* saved queries */
  const [queries, setQueries] = useState<SavedQuery[]>(loadQueries)
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<SavedQuery | null>(null)
  const [deleting, setDeleting] = useState<SavedQuery | null>(null)

  /* tabs */
  const initial = loadTabs()
  const [tabs, setTabs] = useState<SqlTab[]>(initial.tabs.length ? initial.tabs : [{ id: newId(), queryId: null, sql: '' }])
  const [activeId, setActiveId] = useState<string>(initial.active ?? (initial.tabs[0]?.id || ''))
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  /* run state */
  const [role, setRole] = useState<RolePreview>({ kind: 'postgres' })
  const [limit, setLimit] = useState<number | null>(100)
  const [result, setResult] = useState<SqlResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [savingNew, setSavingNew] = useState(false)

  /* schema words for autocomplete */
  const wordsRef = useRef<{ caption: string; value: string; meta: string }[]>([])
  useEffect(() => {
    registerSchemaCompleter(() => wordsRef.current)
    api.tables().then(
      (ts) => {
        const words: { caption: string; value: string; meta: string }[] = []
        for (const t of ts) {
          words.push({ caption: t.name, value: t.name, meta: 'table' })
          for (const c of t.columns) words.push({ caption: `${t.name}.${c.name}`, value: c.name, meta: c.type })
        }
        wordsRef.current = words
      },
      () => {}
    )
  }, [])

  /* persistence */
  useEffect(() => saveTabs(tabs, active?.id ?? null), [tabs, active])
  const persistQueries = useCallback((qs: SavedQuery[]) => {
    setQueries(qs)
    saveQueries(qs)
  }, [])

  if (!active) return <Empty>Something went wrong — reload.</Empty>

  const savedFor = (t: SqlTab) => queries.find((q) => q.id === t.queryId) ?? null
  const isDirty = (t: SqlTab) => {
    const s = savedFor(t)
    return s ? s.sql !== t.sql : t.sql.trim() !== ''
  }

  function updateActive(sql: string) {
    setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, sql } : t)))
  }

  function newTab(sql = '', queryId: string | null = null) {
    const t: SqlTab = { id: newId(), queryId, sql }
    setTabs((ts) => [...ts, t])
    setActiveId(t.id)
    setResult(null)
  }

  function closeTab(id: string) {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id)
      if (next.length === 0) {
        const fresh: SqlTab = { id: newId(), queryId: null, sql: '' }
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[Math.max(0, ts.findIndex((t) => t.id === id) - 1)].id)
      return next
    })
  }

  function openSaved(q: SavedQuery) {
    const existing = tabs.find((t) => t.queryId === q.id)
    if (existing) setActiveId(existing.id)
    else newTab(q.sql, q.id)
  }

  function saveActive(name?: string) {
    const saved = savedFor(active)
    if (saved) {
      persistQueries(queries.map((q) => (q.id === saved.id ? { ...q, sql: active.sql, updatedAt: Date.now() } : q)))
      toast.success(`Saved "${saved.name}"`)
    } else if (name) {
      const q: SavedQuery = { id: newId(), name, sql: active.sql, favorite: false, updatedAt: Date.now() }
      persistQueries([q, ...queries])
      setTabs((ts) => ts.map((t) => (t.id === activeId ? { ...t, queryId: q.id } : t)))
      toast.success(`Saved "${name}"`)
    } else {
      setSavingNew(true)
    }
  }

  async function run() {
    const sql = active.sql.trim()
    if (!sql || busy) return
    setBusy(true)
    const opts =
      role.kind === 'postgres'
        ? undefined
        : role.kind === 'anon'
          ? { role: 'anon', claims: { role: 'anon' } }
          : { role: 'authenticated', claims: { role: 'authenticated', sub: role.sub, email: role.email } }
    const res = await api.sql(applyLimit(sql, limit), opts)
    setResult(res)
    setHistory(pushHistory({ sql, ts: Date.now(), ms: res.ms, ok: res.ok, rows: res.rowCount }))
    setBusy(false)
  }

  const q = search.toLowerCase()
  const visible = queries.filter((x) => x.name.toLowerCase().includes(q) || x.sql.toLowerCase().includes(q))
  const favorites = visible.filter((x) => x.favorite)
  const others = visible.filter((x) => !x.favorite)

  return (
    <div className="flex h-full">
      {/* ── saved queries panel ── */}
      <ResizablePanel id="sql-saved" side="left" defaultSize={240} min={200} max={400} className="flex flex-col border-r border-border bg-card">
        <div className="px-4 pb-1 pt-4 text-sm font-semibold text-foreground">SQL Editor</div>
        <div className="space-y-1.5 px-2 pb-2 pt-1">
          <Button variant="outline" size="xs" className="w-full" onClick={() => newTab()}>
            <Plus size={12} /> New query
          </Button>
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search queries…"
              className="h-7 w-full rounded-md border border-border bg-field pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-muted-foreground focus:outline-none"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-2">
          {favorites.length > 0 && <QueryGroup title="Favorites" items={favorites} onOpen={openSaved} onRename={setRenaming} onDelete={setDeleting} onFav={(x) => persistQueries(queries.map((y) => (y.id === x.id ? { ...y, favorite: !y.favorite } : y)))} />}
          <QueryGroup title={`Saved (${others.length})`} items={others} onOpen={openSaved} onRename={setRenaming} onDelete={setDeleting} onFav={(x) => persistQueries(queries.map((y) => (y.id === x.id ? { ...y, favorite: !y.favorite } : y)))} />
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground/60">
              {queries.length === 0 ? 'No saved queries yet — write one and hit Save.' : 'No match.'}
            </p>
          )}
        </div>
      </ResizablePanel>

      {/* ── main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* tabs */}
        <div className="flex shrink-0 items-center gap-px overflow-x-auto border-b border-border bg-card px-1 pt-1">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={
                'group flex shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-x border-t px-3 py-1.5 text-xs ' +
                (t.id === activeId
                  ? 'border-border bg-background text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
              onClick={() => setActiveId(t.id)}
            >
              <span className="max-w-40 truncate">{titleFor(t.sql, savedFor(t))}</span>
              {isDirty(t) && <span className="size-1.5 shrink-0 rounded-full bg-brand" title="Unsaved changes" />}
              <button
                className="rounded p-px text-muted-foreground/60 opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          <button className="ml-1 rounded p-1 text-muted-foreground/80 hover:bg-accent hover:text-foreground" title="New tab" onClick={() => newTab()}>
            <Plus size={13} />
          </button>
        </div>

        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-1.5">
          <RolePicker align="start" value={role} onChange={(r) => setRole(r)} />
          <Select
            size="xs"
            className="w-26 shrink-0"
            value={limit === null ? 'none' : String(limit)}
            onValueChange={(v) => setLimit(v === 'none' ? null : parseInt(v, 10))}
            options={[
              { value: '100', label: 'Limit 100' },
              { value: '500', label: 'Limit 500' },
              { value: '1000', label: 'Limit 1000' },
              { value: 'none', label: 'No limit' },
            ]}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Popover
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              align="end"
              className="max-h-96 w-105 overflow-y-auto p-1.5"
              trigger={
                <Button variant="ghost" size="xs" onClick={() => setHistoryOpen((o) => !o)}>
                  <History size={12} /> History
                </Button>
              }
            >
              {history.length === 0 && <p className="px-3 py-4 text-center text-xs text-muted-foreground/60">No runs yet.</p>}
              {history.map((h, i) => (
                <button
                  key={i}
                  className="block w-full rounded px-2.5 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    newTab(h.sql)
                    setHistoryOpen(false)
                  }}
                >
                  <span className="block truncate font-mono text-xs text-foreground/80">{h.sql}</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    <Time value={h.ts} format="time" /> · {h.ok ? `${h.rows ?? 0} rows · ${h.ms} ms` : 'error'}
                  </span>
                </button>
              ))}
              {history.length > 0 && (
                <button
                  className="mt-1 w-full rounded px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
                  onClick={() => setHistory(clearHistory())}
                >
                  Clear history
                </button>
              )}
            </Popover>
            <Button variant="ghost" size="xs" title="Format query" onClick={() => updateActive(formatSql(active.sql))}>
              <WandSparkles size={12} /> Format
            </Button>
            <Button variant="outline" size="xs" onClick={() => saveActive()} disabled={!active.sql.trim()}>
              {savedFor(active) ? 'Save' : 'Save as…'}
            </Button>
            <Button size="xs" onClick={() => void run()} disabled={busy || !active.sql.trim()}>
              <Play size={12} /> {busy ? 'Running…' : 'Run'} <Kbd>⌘⏎</Kbd>
            </Button>
          </div>
        </div>

        {/* editor */}
        <div className="min-h-0 flex-1 p-3 pb-0">
          <CodeEditor
            lang="sql"
            className="h-full"
            value={active.sql}
            onChange={updateActive}
            onCmdEnter={() => void run()}
            placeholder="select * from …   (⌘⏎ to run)"
          />
        </div>

        {/* results */}
        <ResizablePanel id="sql-results" axis="y" side="right" defaultSize={300} min={140} max={640} className="overflow-hidden border-t border-border">
          <ResultsPanel result={result} />
        </ResizablePanel>
      </div>

      {/* ── dialogs ── */}
      {renaming && (
        <RenameQueryDialog
          query={renaming}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            persistQueries(queries.map((x) => (x.id === renaming.id ? { ...x, name } : x)))
            setRenaming(null)
          }}
        />
      )}
      {savingNew && (
        <SaveAsDialog
          suggested={titleFor(active.sql, null)}
          onClose={() => setSavingNew(false)}
          onSave={(name) => {
            saveActive(name)
            setSavingNew(false)
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          danger
          title={`Delete query "${deleting.name}"?`}
          description="The saved query will be removed from this browser."
          confirmLabel="Delete query"
          onConfirm={() => {
            persistQueries(queries.filter((x) => x.id !== deleting.id))
            setTabs((ts) => ts.map((t) => (t.queryId === deleting.id ? { ...t, queryId: null } : t)))
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  )
}

/* ── pieces ── */

function QueryGroup({
  title,
  items,
  onOpen,
  onRename,
  onDelete,
  onFav,
}: {
  title: string
  items: SavedQuery[]
  onOpen: (q: SavedQuery) => void
  onRename: (q: SavedQuery) => void
  onDelete: (q: SavedQuery) => void
  onFav: (q: SavedQuery) => void
}) {
  return (
    <div className="pt-2">
      <p className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</p>
      {items.map((x) => (
        <div key={x.id} className="group flex items-center gap-1 pl-4 pr-1.5 text-[13px] text-muted-foreground hover:bg-accent/50">
          <button className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left" onClick={() => onOpen(x)} title={x.sql}>
            {x.favorite && <Heart size={10} className="shrink-0 fill-brand text-brand" />}
            <span className="truncate">{x.name}</span>
          </button>
          <Menu>
            <MenuTrigger asChild>
              <button className="hidden shrink-0 rounded p-1 text-muted-foreground/80 hover:bg-muted hover:text-foreground group-hover:block data-[state=open]:block">
                <MoreVertical size={12} />
              </button>
            </MenuTrigger>
            <MenuContent align="start">
              <MenuItem onSelect={() => onFav(x)}>
                <Heart size={13} /> {x.favorite ? 'Unfavorite' : 'Favorite'}
              </MenuItem>
              <MenuItem onSelect={() => onRename(x)}>
                <Pencil size={13} /> Rename
              </MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={() => onDelete(x)}>
                <Trash2 size={13} /> Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ))}
    </div>
  )
}

function RenameQueryDialog({ query, onClose, onSave }: { query: SavedQuery; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(query.name)
  return (
    <Dialog open onClose={onClose} title="Rename query">
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(name.trim())} disabled={!name.trim()}>
            Rename
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function SaveAsDialog({ suggested, onClose, onSave }: { suggested: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(suggested === 'Untitled query' ? '' : suggested)
  return (
    <Dialog open onClose={onClose} title="Save query">
      <div className="space-y-3">
        <div>
          <Label>Name</Label>
          <Input value={name} autoFocus placeholder="My query" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(name.trim())} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
