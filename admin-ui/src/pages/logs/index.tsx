import { ChevronDown, Download, Pause, Play, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type LogEntry } from '../../api'
import {
  Badge,
  Button,
  Checkbox,
  CodeView,
  ConfirmDialog,
  CopyButton,
  Empty,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  ResizablePanel,
  Spinner,
  Time,
} from '../../components/ui'
import { downloadFile } from '../../lib/export'

type Level = LogEntry['level']

/* ── parsing ─────────────────────────────────────────────────────────────────
 * Request lines look like `GET /rest/v1/posts → 200`; everything else
 * (migrations, emails, webhooks, cron…) is a plain server event.            */

export interface ParsedLog extends LogEntry {
  method: string | null
  path: string | null
  status: number | null
  service: string
}

const REQUEST_RE = /^([A-Z]+)\s+(\S+)\s+→\s+(\d{3})\b/

function serviceOf(path: string | null, msg: string): string {
  if (path) {
    if (path.startsWith('/rest/')) return 'REST'
    if (path.startsWith('/auth/')) return 'Auth'
    if (path.startsWith('/storage/')) return 'Storage'
    if (path.startsWith('/realtime/')) return 'Realtime'
    if (path.startsWith('/functions/')) return 'Functions'
    if (path.startsWith('/admin/')) return 'Admin'
    if (path.startsWith('/inbox')) return 'Inbox'
    if (path === '/_' || path.startsWith('/_/')) return 'Studio'
    return 'Server'
  }
  const m = msg.toLowerCase()
  if (m.includes('cron')) return 'Cron'
  if (m.includes('webhook') || m.includes('http')) return 'Webhooks'
  if (m.includes('mail') || m.includes('otp') || m.includes('magic')) return 'Auth'
  if (m.includes('migration')) return 'Migrations'
  return 'Server'
}

function parse(l: LogEntry): ParsedLog {
  const m = REQUEST_RE.exec(l.msg)
  const method = m?.[1] ?? null
  const path = m?.[2] ?? null
  const status = m ? parseInt(m[3], 10) : null
  return { ...l, method, path, status, service: serviceOf(path, l.msg) }
}

const statusClass = (s: number | null) => (s === null ? null : `${Math.floor(s / 100)}xx`)

/* ── time ranges ── */

const RANGES = [
  { key: 'all', label: 'All time', ms: null },
  { key: '1m', label: 'Last minute', ms: 60_000 },
  { key: '5m', label: 'Last 5 min', ms: 300_000 },
  { key: '15m', label: 'Last 15 min', ms: 900_000 },
  { key: '1h', label: 'Last hour', ms: 3_600_000 },
] as const
type RangeKey = (typeof RANGES)[number]['key']

/* ── page ── */

/**
 * Unified log explorer: facet sidebar (service / level / method / status),
 * time range, search, request-aware columns, volume histogram, live tail,
 * row detail panel, export and clear.
 */
export function LogsPage() {
  const [raw, setRaw] = useState<LogEntry[] | null>(null)
  const [live, setLive] = useState(true)
  const [range, setRange] = useState<RangeKey>('all')
  const [services, setServices] = useState<Set<string>>(new Set())
  const [levels, setLevels] = useState<Set<Level>>(new Set())
  const [methods, setMethods] = useState<Set<string>>(new Set())
  const [statuses, setStatuses] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ParsedLog | null>(null)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRaw(await api.logs())
    } catch {
      // transient — keep the last snapshot
    }
  }, [])

  useEffect(() => {
    void load()
    if (!live) return
    const t = setInterval(load, 2000)
    return () => clearInterval(t)
  }, [live, load])

  const logs = useMemo(() => (raw ?? []).map(parse), [raw])

  /* facet counts are computed over the time+search window so the sidebar
     numbers always add up to what the table could show */
  const window_ = useMemo(() => {
    const ms = RANGES.find((r) => r.key === range)!.ms
    const cutoff = ms === null ? 0 : Date.now() - ms
    const q = search.toLowerCase()
    return logs.filter((l) => (cutoff === 0 || Date.parse(l.ts) >= cutoff) && (!q || l.msg.toLowerCase().includes(q)))
  }, [logs, range, search])

  const counts = useMemo(() => {
    const svc = new Map<string, number>()
    const lvl: Record<Level, number> = { info: 0, warn: 0, error: 0 }
    const mth = new Map<string, number>()
    const sts = new Map<string, number>()
    for (const l of window_) {
      svc.set(l.service, (svc.get(l.service) ?? 0) + 1)
      lvl[l.level]++
      if (l.method) mth.set(l.method, (mth.get(l.method) ?? 0) + 1)
      const sc = statusClass(l.status)
      if (sc) sts.set(sc, (sts.get(sc) ?? 0) + 1)
    }
    return { svc, lvl, mth, sts }
  }, [window_])

  const visible = useMemo(
    () =>
      window_
        .filter(
          (l) =>
            (services.size === 0 || services.has(l.service)) &&
            (levels.size === 0 || levels.has(l.level)) &&
            (methods.size === 0 || (l.method !== null && methods.has(l.method))) &&
            (statuses.size === 0 || (statusClass(l.status) !== null && statuses.has(statusClass(l.status)!)))
        )
        .reverse(), // newest first
    [window_, services, levels, methods, statuses]
  )

  const activeFilters = services.size + levels.size + methods.size + statuses.size + (search ? 1 : 0) + (range !== 'all' ? 1 : 0)

  if (raw === null) return <Spinner />

  return (
    <div className="flex h-full">
      {/* ── facet sidebar ── */}
      <ResizablePanel id="logs-facets" side="left" defaultSize={224} min={180} max={360} className="flex flex-col overflow-y-auto border-r border-border bg-card">
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
          <span className="text-sm font-semibold text-foreground">Logs</span>
          {activeFilters > 0 && (
            <button
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setServices(new Set())
                setLevels(new Set())
                setMethods(new Set())
                setStatuses(new Set())
                setSearch('')
                setRange('all')
              }}
            >
              <X size={10} /> Clear ({activeFilters})
            </button>
          )}
        </div>

        <FacetGroup title="Time range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={
                'flex w-full items-center rounded px-2 py-1 text-left text-xs transition-colors ' +
                (range === r.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')
              }
            >
              {r.label}
            </button>
          ))}
        </FacetGroup>

        <FacetGroup title="Service">
          {[...counts.svc.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([svc, n]) => (
              <FacetRow key={svc} label={svc} count={n} checked={services.has(svc)} onToggle={() => setServices(toggle(services, svc))} />
            ))}
          {counts.svc.size === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground/50">No entries</p>}
        </FacetGroup>

        <FacetGroup title="Level">
          {(['info', 'warn', 'error'] as Level[]).map((lv) => (
            <FacetRow
              key={lv}
              label={lv}
              count={counts.lvl[lv]}
              dot={lv === 'error' ? 'bg-destructive' : lv === 'warn' ? 'bg-warning' : 'bg-muted-foreground/60'}
              checked={levels.has(lv)}
              onToggle={() => setLevels(toggle(levels, lv))}
            />
          ))}
        </FacetGroup>

        <FacetGroup title="Method">
          {['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS']
            .filter((m) => counts.mth.has(m))
            .map((m) => (
              <FacetRow key={m} label={m} mono count={counts.mth.get(m)!} checked={methods.has(m)} onToggle={() => setMethods(toggle(methods, m))} />
            ))}
          {counts.mth.size === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground/50">No requests</p>}
        </FacetGroup>

        <FacetGroup title="Status">
          {['2xx', '3xx', '4xx', '5xx']
            .filter((s) => counts.sts.has(s))
            .map((s) => (
              <FacetRow
                key={s}
                label={s}
                mono
                count={counts.sts.get(s)!}
                dot={s === '2xx' ? 'bg-brand' : s === '4xx' ? 'bg-warning' : s === '5xx' ? 'bg-destructive' : 'bg-muted-foreground/60'}
                checked={statuses.has(s)}
                onToggle={() => setStatuses(toggle(statuses, s))}
              />
            ))}
          {counts.sts.size === 0 && <p className="px-2 py-1 text-[11px] text-muted-foreground/50">No responses</p>}
        </FacetGroup>
      </ResizablePanel>

      {/* ── main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <div className="relative min-w-0 flex-1 max-w-md">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search events…"
              className="h-7 w-full rounded-md border border-input bg-field pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground/70">
            {visible.length.toLocaleString()} event{visible.length === 1 ? '' : 's'}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant={live ? 'outline' : 'ghost'} size="xs" onClick={() => setLive((v) => !v)}>
              {live ? (
                <>
                  <Pause size={12} /> Live <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                </>
              ) : (
                <>
                  <Play size={12} /> Paused
                </>
              )}
            </Button>
            <Button variant="ghost" size="iconXs" title="Refresh" onClick={() => void load()}>
              <RefreshCw size={13} />
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button variant="ghost" size="xs" title="Download logs">
                  <Download size={13} /> <ChevronDown size={10} />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem
                  onSelect={() => downloadFile('tinbase-logs.txt', 'text/plain', visible.map((l) => `${l.ts} ${l.level.toUpperCase()} ${l.msg}`).join('\n'))}
                >
                  Download .txt
                </MenuItem>
                <MenuItem onSelect={() => downloadFile('tinbase-logs.json', 'application/json', JSON.stringify(visible, null, 2))}>
                  Download .json
                </MenuItem>
              </MenuContent>
            </Menu>
            <Button variant="ghost" size="iconXs" title="Clear logs" onClick={() => setClearing(true)}>
              <Trash2 size={13} />
            </Button>
          </div>
        </div>

        {/* histogram */}
        <Histogram entries={window_} />

        {/* table */}
        <div className="min-h-0 flex-1 overflow-auto">
          {visible.length === 0 ? (
            <Empty>{logs.length === 0 ? 'No logs yet. Make a request or trigger an email/webhook.' : 'No entries match the filters.'}</Empty>
          ) : (
            <table className="w-full border-collapse font-mono text-[12px]">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  <th className="w-24 px-3 py-1.5 font-medium">Time</th>
                  <th className="w-16 px-2 py-1.5 font-medium">Level</th>
                  <th className="w-20 px-2 py-1.5 font-medium">Service</th>
                  <th className="w-16 px-2 py-1.5 font-medium">Method</th>
                  <th className="w-12 px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium">Event</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((l, i) => (
                  <tr
                    key={`${l.ts}-${i}`}
                    onClick={() => setSelected(l)}
                    className={
                      'cursor-pointer border-b border-border/40 transition-colors hover:bg-accent/40 ' +
                      (selected === l ? 'bg-selected ' : '') +
                      (l.level === 'error' ? 'bg-destructive/5' : '')
                    }
                  >
                    <td className="whitespace-nowrap px-3 py-1 text-muted-foreground/70">
                      <Time value={l.ts} format="time" />
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={
                          'inline-block size-2 rounded-full ' +
                          (l.level === 'error' ? 'bg-destructive' : l.level === 'warn' ? 'bg-warning' : 'bg-muted-foreground/40')
                        }
                        title={l.level}
                      />
                    </td>
                    <td className="px-2 py-1 text-muted-foreground/80">{l.service}</td>
                    <td className="px-2 py-1 text-foreground/70">{l.method ?? ''}</td>
                    <td className="px-2 py-1">
                      {l.status !== null && (
                        <span
                          className={
                            l.status >= 500 ? 'text-destructive' : l.status >= 400 ? 'text-warning' : 'text-brand'
                          }
                        >
                          {l.status}
                        </span>
                      )}
                    </td>
                    <td className="max-w-0 truncate px-2 py-1 text-foreground/85" title={l.msg}>
                      {l.path ?? l.msg}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── detail panel ── */}
      {selected && <DetailPanel entry={selected} onClose={() => setSelected(null)} />}

      {clearing && (
        <ConfirmDialog
          open
          danger
          title="Clear all logs?"
          description="The in-memory log buffer is emptied — this cannot be undone."
          confirmLabel="Clear logs"
          onConfirm={() => {
            void api.clearLogs().then(load)
            setSelected(null)
          }}
          onClose={() => setClearing(false)}
        />
      )}
    </div>
  )
}

/* ── pieces ── */

function toggle<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set)
  if (next.has(v)) next.delete(v)
  else next.add(v)
  return next
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{title}</p>
      {children}
    </div>
  )
}

function FacetRow({
  label,
  count,
  checked,
  onToggle,
  dot,
  mono,
}: {
  label: string
  count: number
  checked: boolean
  onToggle: () => void
  dot?: string
  mono?: boolean
}) {
  return (
    <button
      onClick={onToggle}
      className="group flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
    >
      <Checkbox checked={checked} onChange={onToggle} />
      {dot && <span className={`size-1.5 shrink-0 rounded-full ${dot}`} />}
      <span className={'min-w-0 flex-1 truncate ' + (mono ? 'font-mono' : '')}>{label}</span>
      <span className="tabular-nums text-muted-foreground/50">{count.toLocaleString()}</span>
    </button>
  )
}

/** Event-volume histogram over the current window — errors stack in red. */
function Histogram({ entries }: { entries: ParsedLog[] }) {
  const BUCKETS = 60
  const data = useMemo(() => {
    if (entries.length === 0) return null
    let min = Infinity
    let max = -Infinity
    const times = entries.map((e) => Date.parse(e.ts))
    for (const t of times) {
      if (t < min) min = t
      if (t > max) max = t
    }
    if (max === min) max = min + 1
    const span = max - min
    const buckets = Array.from({ length: BUCKETS }, () => ({ ok: 0, err: 0 }))
    entries.forEach((e, i) => {
      const b = Math.min(BUCKETS - 1, Math.floor(((times[i] - min) / span) * BUCKETS))
      if (e.level === 'error' || (e.status !== null && e.status >= 500)) buckets[b].err++
      else buckets[b].ok++
    })
    const peak = Math.max(...buckets.map((b) => b.ok + b.err))
    return { buckets, peak, min, max }
  }, [entries])

  if (!data) return null
  return (
    <div className="flex h-12 shrink-0 items-end gap-px border-b border-border px-3 pb-1 pt-2" title="Event volume">
      {data.buckets.map((b, i) => {
        const total = b.ok + b.err
        const h = total === 0 ? 0 : Math.max(8, (total / data.peak) * 100)
        return (
          <div key={i} className="flex min-w-0 flex-1 flex-col justify-end self-stretch" title={`${total} events`}>
            {total > 0 && (
              <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
                {b.err > 0 && <div className="w-full bg-destructive/70" style={{ flexGrow: b.err }} />}
                <div className="w-full bg-brand/40" style={{ flexGrow: b.ok }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  303: 'See Other',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
}

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return ''
  const units: [number, string][] = [
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second'],
  ]
  for (const [ms, label] of units) {
    if (Math.abs(diff) >= ms) {
      const n = Math.round(Math.abs(diff) / ms)
      return `${n} ${label}${n === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}

/** Label/value row with a hover copy affordance, Supabase-style. */
function FactRow({ label, copy, children }: { label: string; copy?: string; children: React.ReactNode }) {
  return (
    <div className="group flex items-start gap-3 rounded px-1 py-1 -mx-1 hover:bg-accent/40">
      <span className="w-24 shrink-0 pt-px font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-right text-[12.5px] text-foreground/90">{children}</span>
      {copy !== undefined && (
        <span className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <CopyButton value={copy} label={label} />
        </span>
      )}
    </div>
  )
}

function FactSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 border-b border-border pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

/** Right-hand detail panel for a selected log entry: grouped request facts + raw JSON. */
function DetailPanel({ entry, onClose }: { entry: ParsedLog; onClose: () => void }) {
  const d = new Date(entry.ts)
  const [pathOnly, query] = (entry.path ?? '').split('?')
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <ResizablePanel id="logs-detail" side="right" defaultSize={400} min={300} max={640} className="flex flex-col border-l border-border bg-card">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <span className="text-[13px] font-medium text-foreground">Event details</span>
        <div className="flex items-center gap-1">
          <CopyButton value={JSON.stringify(entry, null, 2)} label="Event JSON" />
          <button className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <FactSection title="Event">
          <FactRow label="Timestamp" copy={entry.ts}>
            <span className="font-mono text-[12px]">{entry.ts}</span>
          </FactRow>
          <FactRow label="Local">
            <span className="font-mono text-[12px]" title={localTz}>
              {d.toLocaleString()}
            </span>
          </FactRow>
          <FactRow label="Relative">{relativeTime(entry.ts)}</FactRow>
          <FactRow label="Level">
            <Badge variant={entry.level === 'error' ? 'red' : entry.level === 'warn' ? 'amber' : 'neutral'}>{entry.level}</Badge>
          </FactRow>
          <FactRow label="Service" copy={entry.service}>
            {entry.service}
          </FactRow>
        </FactSection>

        {entry.method && (
          <FactSection title="Request">
            <FactRow label="Method" copy={entry.method}>
              <span className="font-mono text-[12px]">{entry.method}</span>
            </FactRow>
            <FactRow label="Path" copy={pathOnly}>
              <span className="break-all font-mono text-[12px]">{pathOnly}</span>
            </FactRow>
            {query && (
              <FactRow label="Query" copy={query}>
                <span className="break-all font-mono text-[11px] text-muted-foreground">{query}</span>
              </FactRow>
            )}
            {entry.status !== null && (
              <FactRow label="Status" copy={String(entry.status)}>
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant={entry.status >= 500 ? 'red' : entry.status >= 400 ? 'amber' : 'brand'}>{entry.status}</Badge>
                  {STATUS_TEXT[entry.status] && <span className="text-[11px] text-muted-foreground">{STATUS_TEXT[entry.status]}</span>}
                </span>
              </FactRow>
            )}
          </FactSection>
        )}

        <FactSection title="Message">
          <pre className="whitespace-pre-wrap wrap-break-word rounded-md border border-border bg-code p-3 font-mono text-[12px] leading-relaxed text-foreground/90">
            {entry.msg}
          </pre>
        </FactSection>

        <FactSection title="Raw JSON">
          <div className="overflow-hidden rounded-md border border-border bg-code px-1 py-2">
            <CodeView value={JSON.stringify(entry, null, 2)} lang="js" readOnly minLines={6} maxLines={16} />
          </div>
        </FactSection>
      </div>
    </ResizablePanel>
  )
}
