/**
 * Shared schema selection — one selection used by the table editor, the
 * database catalog pages and the visualizer, persisted across reloads.
 */
import { useSyncExternalStore } from 'react'

const SCHEMA_KEY = 'tinbase_db_schema'
let currentSchema = localStorage.getItem(SCHEMA_KEY) || 'public'
const listeners = new Set<() => void>()

/** The currently selected schema plus its setter (shared, persisted). */
export function useDbSchema(): [string, (s: string) => void] {
  const schema = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => currentSchema
  )
  return [schema, setDbSchema]
}

export function setDbSchema(s: string) {
  currentSchema = s
  localStorage.setItem(SCHEMA_KEY, s)
  listeners.forEach((cb) => cb())
}

/** Schema-qualify + quote a table name for DDL (`"auth"."users"`, `"posts"` for public). */
export function qualify(schema: string, table: string): string {
  const q = (s: string) => '"' + s.replace(/"/g, '""') + '"'
  return schema === 'public' ? q(table) : `${q(schema)}.${q(table)}`
}

/**
 * Schemas owned by tinbase itself (mirroring Supabase's managed schemas).
 * They are NOT exposed through the Data API for anon/authenticated — access
 * is controlled by grants and privileged services, not RLS — so the studio
 * renders them read-only and doesn't nag about missing policies.
 */
const MANAGED = new Set([
  'auth',
  'storage',
  'realtime',
  'vault',
  'cron',
  'pgmq',
  'net',
  'extensions',
  'graphql',
  'supabase_migrations',
  'supabase_functions',
  'information_schema',
])

export function isManagedSchema(schema: string): boolean {
  return MANAGED.has(schema) || schema.startsWith('pg_')
}
