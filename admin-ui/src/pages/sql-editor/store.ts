/**
 * SQL editor state: saved queries, open tabs, and run history — persisted in
 * localStorage so the editor survives reloads. Pure logic, no JSX.
 */

export interface SavedQuery {
  id: string
  name: string
  sql: string
  favorite: boolean
  updatedAt: number
}

export interface SqlTab {
  id: string
  /** linked saved query, when the tab was opened from one */
  queryId: string | null
  sql: string
}

export interface HistoryEntry {
  sql: string
  ts: number
  ms?: number
  ok: boolean
  rows?: number
}

const QUERIES_KEY = 'tinbase_sql_queries'
const TABS_KEY = 'tinbase_sql_tabs'
const HISTORY_KEY = 'tinbase_sql_history'
const HISTORY_MAX = 50

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage full/blocked — editor still works, just not persisted
  }
}

export const loadQueries = () => read<SavedQuery[]>(QUERIES_KEY, [])
export const saveQueries = (q: SavedQuery[]) => write(QUERIES_KEY, q)

export const loadTabs = () => read<{ tabs: SqlTab[]; active: string | null }>(TABS_KEY, { tabs: [], active: null })
export const saveTabs = (tabs: SqlTab[], active: string | null) => write(TABS_KEY, { tabs, active })

export const loadHistory = () => read<HistoryEntry[]>(HISTORY_KEY, [])
export function pushHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, HISTORY_MAX)
  write(HISTORY_KEY, next)
  return next
}
export function clearHistory(): HistoryEntry[] {
  write(HISTORY_KEY, [])
  return []
}

export const newId = () => crypto.randomUUID()

/** Derive a tab title from the first meaningful tokens of the SQL. */
export function titleFor(sql: string, saved?: SavedQuery | null): string {
  if (saved) return saved.name
  const clean = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!clean) return 'Untitled query'
  return clean.length > 32 ? clean.slice(0, 32) + '…' : clean
}

/** Append a LIMIT to bare selects when a results cap is chosen. */
export function applyLimit(sql: string, limit: number | null): string {
  if (!limit) return sql
  const s = sql.trim().replace(/;+\s*$/, '')
  if (!/^\s*(select|with)\b/i.test(s)) return sql
  if (/\blimit\s+\d+/i.test(s)) return sql
  return `${s} limit ${limit}`
}

const CLAUSES = /\b(select|from|where|group by|order by|having|limit|offset|left join|right join|inner join|join|union|insert into|values|update|set|delete from|returning)\b/gi

/** Very small formatter: uppercase keywords + newline before major clauses. */
export function formatSql(sql: string): string {
  return sql
    .replace(CLAUSES, (m) => `\n${m.toUpperCase()}`)
    .replace(/^\n/, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
}
