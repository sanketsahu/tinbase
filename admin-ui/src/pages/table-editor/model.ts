import type { Column } from '../../api'

/* ── filter model ───────────────────────────────────────────────────────────── */

export interface OpDef {
  op: string
  label: string
  sym: string
  group: 'Comparison' | 'Pattern matching' | 'Null' | 'Lists'
  noValue?: boolean
}

export const OPS: OpDef[] = [
  { op: 'eq', label: 'Equals', sym: '=', group: 'Comparison' },
  { op: 'neq', label: 'Not equal', sym: '<>', group: 'Comparison' },
  { op: 'gt', label: 'Greater than', sym: '>', group: 'Comparison' },
  { op: 'lt', label: 'Less than', sym: '<', group: 'Comparison' },
  { op: 'gte', label: 'Greater or equal', sym: '>=', group: 'Comparison' },
  { op: 'lte', label: 'Less or equal', sym: '<=', group: 'Comparison' },
  { op: 'like', label: 'Like', sym: '~~', group: 'Pattern matching' },
  { op: 'ilike', label: 'iLike', sym: '~~*', group: 'Pattern matching' },
  { op: 'in', label: 'In list', sym: 'in', group: 'Lists' },
  { op: 'is', label: 'Is NULL', sym: 'null', group: 'Null', noValue: true },
  { op: 'not.is', label: 'Is not NULL', sym: '!null', group: 'Null', noValue: true },
]

export const OP_GROUPS = ['Comparison', 'Pattern matching', 'Lists', 'Null'] as const

/**
 * A single filter row. A `column` of `'*'` means a quick search across all
 * text columns rather than a filter on one specific column.
 */
export interface FilterRule {
  id: number
  column: string
  op: string
  value: string
}

export interface SortRule {
  column: string
  dir: 'asc' | 'desc'
}

/** Column types that quick search / FK search can `ilike` over. */
export const TEXTISH = new Set(['text', 'varchar', 'bpchar', 'char', 'name', 'citext'])

/**
 * Build a PostgREST `or=(…ilike…)` pair that searches every text column for
 * the given query.
 *
 * @param cols - Columns of the table being searched.
 * @param q - Raw quick-search query.
 * @returns A `[key, value]` PostgREST query pair, or `null` if there are no
 *   text columns to search.
 */
export function quickSearchPair(cols: Column[], q: string): [string, string] | null {
  const targets = cols.filter((c) => TEXTISH.has(c.type)).map((c) => c.name)
  if (targets.length === 0) return null
  const clean = q.replace(/[(),]/g, ' ').trim()
  return ['or', `(${targets.map((c) => `${c}.ilike.*${clean}*`).join(',')})`]
}

/**
 * Translate filter rules into raw PostgREST query pairs.
 *
 * @param cols - Columns of the table being filtered.
 * @param rules - Active filter rules.
 * @returns The PostgREST `[key, value]` pairs for the rules.
 */
export function buildFilterPairs(cols: Column[], rules: FilterRule[]): [string, string][] {
  const pairs: [string, string][] = []
  for (const f of rules) {
    if (f.column === '*') {
      const pair = quickSearchPair(cols, f.value)
      if (pair) pairs.push(pair)
    } else if (f.op === 'is' || f.op === 'not.is') {
      pairs.push([f.column, `${f.op}.null`])
    } else if (f.op === 'in') {
      pairs.push([f.column, `in.(${f.value})`])
    } else {
      pairs.push([f.column, `${f.op}.${f.value}`])
    }
  }
  return pairs
}

/* ── grid geometry ──────────────────────────────────────────────────────────── */

/** Screen-space rect of a grid cell (from `getBoundingClientRect`). */
export interface CellAnchor {
  top: number
  left: number
  width: number
  height: number
}

/** Width of the checkbox/expand gutter column. */
export const CHECK_W = 56

/**
 * Default pixel width for a column based on its Postgres type.
 *
 * @param c - The column to size.
 * @returns The default column width in pixels.
 */
export function defaultWidth(c: Column): number {
  const t = c.type
  if (t === 'uuid') return 300
  if (t === 'bool') return 100
  if (/^(int|float|numeric)/.test(t)) return 110
  if (/timestamp|date|time/.test(t)) return 220
  if (t === 'json' || t === 'jsonb' || t.startsWith('_')) return 240
  return 190
}

/* ── temporal helpers ───────────────────────────────────────────────────────── */

/**
 * Render "now" in the exact literal format Postgres uses for a given temporal
 * type (e.g. `2026-07-11 19:00:00.123+00` for `timestamptz`, `2026-07-11` for
 * `date`, `19:00:00.123+00` for `timetz`, `19:00:00` for `time`). Order
 * matters: `timestamp*` must be checked before `time*`.
 *
 * @param type - The Postgres temporal type name.
 * @returns The current time formatted for that type.
 */
export function nowFor(type: string): string {
  const iso = new Date().toISOString()
  if (type.startsWith('timestamp')) return iso.replace('T', ' ').replace('Z', '+00')
  if (type === 'date') return iso.slice(0, 10)
  if (type === 'timetz') return iso.slice(11, 23) + '+00'
  if (type.startsWith('time')) return iso.slice(11, 19)
  return iso
}

/**
 * Parse a Postgres-style temporal literal (space separator, bare `+00` offset)
 * into a `Date`. A bare `±HH` offset is normalized to `±HH:MM` since JS `Date`
 * requires it.
 *
 * @param raw - The raw temporal literal.
 * @returns The parsed `Date`, or `null` if empty or unparseable.
 */
export function parseTemporal(raw: string): Date | null {
  const s = raw.trim()
  if (!s) return null
  let t = s.includes('T') ? s : s.replace(' ', 'T')
  if (/[+-]\d\d$/.test(t)) t += ':00'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

/* ── value coercion ─────────────────────────────────────────────────────────── */

/**
 * Coerce a raw string from an input into the wire value for a column type.
 *
 * @param raw - The raw string value from the input.
 * @param type - The Postgres column type name.
 * @returns The coerced value (boolean, number, parsed JSON, or the original
 *   string when coercion does not apply or fails).
 */
export function coerce(raw: string, type: string): unknown {
  if (type === 'bool') return raw === 'true' || raw === 't' || raw === '1'
  if (['int2', 'int4', 'int8', 'float4', 'float8', 'numeric'].includes(type)) {
    const n = Number(raw)
    return Number.isNaN(n) ? raw : n
  }
  if (type === 'json' || type === 'jsonb' || type.startsWith('_')) {
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return raw
}
