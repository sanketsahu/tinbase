import { useEffect, useState } from 'react'
import { api } from '../../api'
import { CodeView, CopyButton, Spinner } from '../../components/ui'

interface ColDef {
  name: string
  type: string
  nullable: boolean
  default: string | null
  identityGen: string | null
}

const esc = (s: string) => s.replace(/'/g, "''")

/**
 * Composes a `create table` DDL for a table by reading columns, constraints,
 * and indexes from the Postgres catalogs.
 *
 * @param schema - The schema name.
 * @param table - The table name.
 * @returns The reconstructed `create table` statement (with trailing index DDL).
 */
export async function fetchTableDdl(schema: string, table: string): Promise<string> {
  const s = esc(schema)
  const t = esc(table)
  const rc = `'"${s}"."${t}"'::regclass`
  const res = await api.sql(`select
    (select json_agg(json_build_object(
        'name', column_name, 'type', data_type,
        'nullable', is_nullable = 'YES',
        'default', column_default,
        'identityGen', identity_generation
      ) order by ordinal_position)
      from information_schema.columns
      where table_schema = '${s}' and table_name = '${t}') as cols,
    (select json_agg(json_build_object('name', conname, 'def', pg_get_constraintdef(oid), 'type', contype))
      from pg_constraint where conrelid = ${rc}) as cons,
    (select json_agg(indexdef)
      from pg_indexes i
      where i.schemaname = '${s}' and i.tablename = '${t}'
        and i.indexname not in (select conname from pg_constraint where conrelid = ${rc})) as idxs`)
  if (!res.ok) throw new Error(res.error ?? 'Failed to read table definition')

  const row = (res.rows?.[0] ?? {}) as {
    cols?: ColDef[] | string
    cons?: { name: string; def: string; type: string }[] | string
    idxs?: string[] | string
  }
  const parse = <T,>(v: T[] | string | undefined | null): T[] => (typeof v === 'string' ? JSON.parse(v) : (v ?? []))
  const cols = parse<ColDef>(row.cols)
  const cons = parse<{ name: string; def: string; type: string }>(row.cons)
  const idxs = parse<string>(row.idxs)

  const colLines = cols.map((c) => {
    let line = `${c.name} ${c.type}`
    if (!c.nullable) line += ' not null'
    if (c.identityGen) line += ` generated ${c.identityGen.toLowerCase()} as identity`
    else if (c.default) line += ` default ${c.default}`
    return line
  })
  const order: Record<string, number> = { p: 0, u: 1, f: 2, c: 3 }
  const conLines = cons
    .sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9) || a.name.localeCompare(b.name))
    .map((c) => `constraint ${c.name} ${c.def}`)

  let ddl = `create table ${schema}.${table} (\n  ${[...colLines, ...conLines].join(',\n  ')}\n);`
  if (idxs.length > 0) ddl += '\n\n' + idxs.map((i) => i + ';').join('\n')
  return ddl
}

/**
 * Read-only SQL definition panel (the "Definition" tab of the table editor).
 *
 * @param props.schema - Schema of the table; defaults to `public`.
 * @param props.table - Name of the table whose DDL is shown.
 * @param props.refreshKey - Any changing value forces a DDL refetch (e.g. after column rename/drop).
 */
export function DefinitionView({
  schema = 'public',
  table,
  refreshKey,
}: {
  schema?: string
  table: string
  /** any changing value forces a DDL refetch (e.g. after column rename/drop) */
  refreshKey?: unknown
}) {
  const [ddl, setDdl] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    setDdl(null)
    setErr('')
    fetchTableDdl(schema, table).then(setDdl, (e) => setErr((e as Error).message))
  }, [schema, table, refreshKey])

  if (err)
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-[13px] text-muted-foreground/80">
        Could not generate the definition: <span className="ml-1 text-destructive">{err}</span>
      </div>
    )
  if (ddl === null)
    return (
      <div className="flex-1">
        <Spinner />
      </div>
    )

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <h2 className="text-sm text-foreground/80">
          SQL definition of <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{table}</code>{' '}
          <span className="text-xs text-muted-foreground/60">(read only)</span>
        </h2>
        <CopyButton value={ddl} label="Definition" variant="outline" size="xs">
          Copy
        </CopyButton>
      </div>
      <div className="px-3 pb-4">
        <CodeView value={ddl} lang="sql" readOnly gutter minLines={4} maxLines={500} />
      </div>
    </div>
  )
}
