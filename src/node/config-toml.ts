/**
 * A minimal TOML reader for supabase/config.toml — just enough of the format to
 * read a real Supabase project's settings, without a TOML dependency. It handles
 * the subset config.toml actually uses:
 *
 *   - `[section]` and dotted `[section.sub.name]` table headers
 *   - `key = value` scalars (string, bool, integer)
 *   - single-line string arrays: `key = ["a", "b"]`
 *   - `#` line and inline comments
 *   - `env(VAR)` substitution against process.env (or a provided env)
 *
 * It does NOT handle inline tables (`{ a = 1 }`), multi-line arrays, or dotted
 * keys inside a table body — none of which config.toml uses for the settings we
 * read. Each loader (auth, api, storage, functions, oauth) reads from the one
 * parsed tree instead of re-scanning the file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** A parsed table: its scalar/array values plus nested child tables. */
export interface ConfigTable {
  values: Map<string, string | string[]>
  children: Map<string, ConfigTable>
}

function emptyTable(): ConfigTable {
  return { values: new Map(), children: new Map() }
}

/** Parse config.toml at `projectDir/supabase/config.toml`; empty root if absent/unreadable. */
export function loadConfigToml(projectDir: string, env: NodeJS.ProcessEnv = process.env): ConfigTable {
  let text: string
  try {
    text = readFileSync(join(projectDir, 'supabase', 'config.toml'), 'utf8')
  } catch {
    return emptyTable()
  }
  return parseConfigToml(text, env)
}

/** Parse TOML `text` into a table tree, resolving `env(VAR)` references. */
export function parseConfigToml(text: string, env: NodeJS.ProcessEnv = process.env): ConfigTable {
  const root = emptyTable()
  let current = root
  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine).trim()
    if (!line) continue
    const header = line.match(/^\[([^\]]+)\]$/)
    if (header) {
      current = descend(root, header[1].split('.').map((s) => s.trim()))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/)
    if (!kv) continue
    const value = parseValue(kv[2].trim(), env)
    if (value !== undefined) current.values.set(kv[1], value)
  }
  return root
}

/** Walk/create the table at the given dotted path. */
function descend(root: ConfigTable, path: string[]): ConfigTable {
  let t = root
  for (const key of path) {
    let next = t.children.get(key)
    if (!next) {
      next = emptyTable()
      t.children.set(key, next)
    }
    t = next
  }
  return t
}

/** Remove a `#` comment that isn't inside a quoted string. */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

/** Parse a scalar or single-line array value, resolving env() and stripping quotes. */
function parseValue(raw: string, env: NodeJS.ProcessEnv): string | string[] | undefined {
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim()
    if (inner === '') return []
    return inner
      .split(',')
      .map((s) => resolveScalar(s.trim(), env))
      .filter((s): s is string => s !== undefined && s !== '')
  }
  return resolveScalar(raw, env)
}

/** Strip quotes and expand an `env(VAR)` reference to its value. */
function resolveScalar(raw: string, env: NodeJS.ProcessEnv): string | undefined {
  const v = raw.trim().replace(/^["']|["']$/g, '')
  const m = v.match(/^env\(\s*"?([A-Za-z0-9_]+)"?\s*\)$/)
  if (m) return env[m[1]]
  return v
}

// ── typed accessors ───────────────────────────────────────────────────────

/** Child table at a dotted path, or undefined if any segment is missing. */
export function tableAt(root: ConfigTable, path: string): ConfigTable | undefined {
  let t: ConfigTable | undefined = root
  for (const key of path.split('.')) {
    t = t?.children.get(key)
    if (!t) return undefined
  }
  return t
}

export function getString(table: ConfigTable | undefined, key: string): string | undefined {
  const v = table?.values.get(key)
  return typeof v === 'string' && v !== '' ? v : undefined
}

export function getBool(table: ConfigTable | undefined, key: string): boolean | undefined {
  const v = table?.values.get(key)
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

export function getInt(table: ConfigTable | undefined, key: string): number | undefined {
  const v = table?.values.get(key)
  if (typeof v !== 'string') return undefined
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

export function getStringArray(table: ConfigTable | undefined, key: string): string[] | undefined {
  const v = table?.values.get(key)
  return Array.isArray(v) ? v : undefined
}

/**
 * Parse a Supabase duration string ("1m", "24h", "10s", "50m") to seconds.
 * Returns undefined if absent or malformed.
 */
export function getDurationSeconds(table: ConfigTable | undefined, key: string): number | undefined {
  const v = table?.values.get(key)
  if (typeof v !== 'string') return undefined
  const m = v.trim().match(/^(\d+)\s*(s|m|h)$/i)
  if (!m) {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : undefined
  }
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  return unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n
}

/**
 * Parse a Supabase byte-size string ("50MiB", "5MB", "500KB") to bytes.
 * Returns undefined if absent or malformed.
 */
export function getByteSize(table: ConfigTable | undefined, key: string): number | undefined {
  const v = table?.values.get(key)
  if (typeof v !== 'string') return undefined
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i)
  if (!m) return undefined
  const n = parseFloat(m[1])
  const unit = (m[2] ?? 'b').toLowerCase()
  const mult: Record<string, number> = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 * 1000,
    mib: 1024 * 1024,
    gb: 1000 * 1000 * 1000,
    gib: 1024 * 1024 * 1024,
  }
  return Math.round(n * (mult[unit] ?? 1))
}
