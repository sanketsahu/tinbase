/**
 * `tinbase inspect` core: a lightweight database report - per-table row counts
 * and on-disk size for a schema. Like a tiny `supabase inspect db`, enough to
 * eyeball what's in a local project. (Uses pg_total_relation_size, so it runs
 * on the real-Postgres engines, not the pg-mem subset.)
 */
import { quoteIdent, type Database } from './database.js'

/** One row of the inspect report: a table with its row count and on-disk size. */
export interface TableInfo {
  /** table name (unqualified) */
  table: string
  /** live row count from count(*) */
  rows: number
  /** human-readable total relation size (pg_size_pretty) */
  size: string
}

/** Report per-table row counts and on-disk sizes for a schema, largest first. */
export async function inspectDb(db: Database, schema = 'public'): Promise<TableInfo[]> {
  const tables = await db.query<{ table: string; size: string }>(
    `select c.relname as table,
            pg_size_pretty(pg_total_relation_size(c.oid)) as size
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc, c.relname`,
    [schema]
  )
  const out: TableInfo[] = []
  for (const t of tables.rows) {
    const c = await db.query<{ n: number }>(
      `select count(*)::int as n from ${quoteIdent(schema)}.${quoteIdent(t.table)}`
    )
    out.push({ table: t.table, rows: c.rows[0]?.n ?? 0, size: t.size })
  }
  return out
}
