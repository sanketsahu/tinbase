import { CornerDownLeft, Search, Table2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { Kbd } from '../ui'
import { navigate } from '../../lib/router'
import { NAV_SECTIONS, type Tab } from './nav'

interface Item {
  key: string
  label: string
  group: string
  tab: Tab
  section?: string | null
  icon?: typeof Table2
}

const SECTION_ITEMS: { tab: Tab; section: string; label: string }[] = [
  { tab: 'database', section: 'visualizer', label: 'Database · Schema Visualizer' },
  { tab: 'database', section: 'tables', label: 'Database · Tables' },
  { tab: 'database', section: 'functions', label: 'Database · Functions' },
  { tab: 'database', section: 'triggers', label: 'Database · Triggers' },
  { tab: 'database', section: 'policies', label: 'Database · Policies' },
  { tab: 'database', section: 'enums', label: 'Database · Enumerated Types' },
  { tab: 'database', section: 'indexes', label: 'Database · Indexes' },
  { tab: 'database', section: 'roles', label: 'Database · Roles' },
  { tab: 'database', section: 'migrations', label: 'Database · Migrations' },
  { tab: 'auth', section: 'users', label: 'Authentication · Users' },
  { tab: 'auth', section: 'providers', label: 'Authentication · Providers' },
  { tab: 'functions', section: 'secrets', label: 'Edge Functions · Secrets' },
  { tab: 'functions', section: 'settings', label: 'Edge Functions · Settings' },
  { tab: 'realtime', section: 'inspector', label: 'Realtime · Inspector' },
  { tab: 'realtime', section: 'policies', label: 'Realtime · Policies' },
  { tab: 'realtime', section: 'settings', label: 'Realtime · Settings' },
  { tab: 'automations', section: 'cron', label: 'Automations · Cron' },
  { tab: 'automations', section: 'queues', label: 'Automations · Queues' },
  { tab: 'automations', section: 'webhooks', label: 'Automations · Webhooks' },
  { tab: 'settings', section: 'general', label: 'Settings · General' },
  { tab: 'settings', section: 'api-keys', label: 'Settings · API Keys' },
]

/**
 * Global Ctrl/Cmd+K palette: jump to any page, section, or table.
 * Tables are fetched lazily the first time the palette opens.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [tables, setTables] = useState<string[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setHi(0)
      return
    }
    inputRef.current?.focus()
    if (tables === null) {
      api.tables().then(
        (t) => setTables(t.map((x) => x.name)),
        () => setTables([])
      )
    }
  }, [open, tables])

  const items = useMemo<Item[]>(() => {
    const pages: Item[] = NAV_SECTIONS.flatMap((s) =>
      s.items.map((i) => ({ key: `page:${i.id}`, label: i.label, group: 'Pages', tab: i.id, icon: i.icon }))
    )
    const sections: Item[] = SECTION_ITEMS.map((s) => ({
      key: `sec:${s.tab}/${s.section}`,
      label: s.label,
      group: 'Sections',
      tab: s.tab,
      section: s.section,
    }))
    const tbls: Item[] = (tables ?? []).map((t) => ({
      key: `tbl:${t}`,
      label: t,
      group: 'Tables',
      tab: 'table' as Tab,
      section: t,
      icon: Table2,
    }))
    return [...pages, ...sections, ...tbls]
  }, [tables])

  const q = query.toLowerCase().trim()
  const filtered = q ? items.filter((i) => i.label.toLowerCase().includes(q)) : items.slice(0, 12)

  function go(item: Item) {
    navigate(item.tab, item.section ?? null)
    setOpen(false)
  }

  if (!open) return null

  let lastGroup = ''
  return (
    <>
      <div className="fixed inset-0 z-80 bg-black/50 backdrop-blur-[2px] animate-[fade-in_.1s_ease-out]" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-24 z-80 w-140 max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-lg border border-input bg-popover shadow-2xl animate-[fade-in_.1s_ease-out]">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search size={15} className="shrink-0 text-muted-foreground/60" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHi(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHi((h) => Math.min(h + 1, filtered.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHi((h) => Math.max(h - 1, 0))
              } else if (e.key === 'Enter' && filtered[hi]) {
                go(filtered[hi])
              }
            }}
            placeholder="Jump to a page, section, or table…"
            className="h-11 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground/60">No matches.</p>}
          {filtered.map((item, i) => {
            const showGroup = item.group !== lastGroup
            lastGroup = item.group
            const Icon = item.icon
            return (
              <div key={item.key}>
                {showGroup && (
                  <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                    {item.group}
                  </p>
                )}
                <button
                  onMouseEnter={() => setHi(i)}
                  onClick={() => go(item)}
                  className={
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] ' +
                    (hi === i ? 'bg-accent text-foreground' : 'text-foreground/80')
                  }
                >
                  {Icon && <Icon size={14} className="shrink-0 text-muted-foreground/70" />}
                  <span className={'min-w-0 flex-1 truncate ' + (item.group === 'Tables' ? 'font-mono' : '')}>{item.label}</span>
                  {hi === i && <CornerDownLeft size={12} className="shrink-0 text-muted-foreground/60" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
