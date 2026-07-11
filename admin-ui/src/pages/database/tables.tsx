import { ArrowUpRight, Eye, KeyRound, Lock, Table2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Empty, Spinner, Table, Td, Th, THead, TRow } from '../../components/ui'
import { navigate } from '../../lib/router'
import { isManagedSchema } from '../../lib/schema'
import { CatalogHeader, quoteLit, useDbSchema } from './shared'

interface Row {
  name: string
  rows: number
  size: string
  rls: boolean
  policies: number
  pk: boolean
  view: boolean
  /** views only: created with security_invoker, so caller RLS applies through it */
  invoker: boolean
}

/** All tables in the selected schema with size, row counts, and RLS posture. */
export function TablesSection() {
  const [schema] = useDbSchema()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [tables, meta] = await Promise.all([
        api.tables(schema),
        api.sql(
          `select c.relname as name, c.relrowsecurity as rls,
                  coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false) as invoker,
                  case when c.relkind = 'r' then pg_size_pretty(pg_total_relation_size(c.oid)) end as size,
                  (select count(*)::int from pg_policies p where p.schemaname = ${quoteLit(schema)} and p.tablename = c.relname) as policies
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = ${quoteLit(schema)} and c.relkind in ('r','v') order by c.relname`
        ),
      ])
      const metaMap = new Map(
        ((meta.ok ? meta.rows : []) ?? []).map(
          (m: { name: string; rls: boolean; invoker: boolean; size: string; policies: number }) => [m.name, m]
        )
      )
      setRows(
        tables.map((t) => {
          const m = metaMap.get(t.name)
          return {
            name: t.name,
            rows: t.rowCount,
            size: m?.size ?? '—',
            rls: Boolean(m?.rls),
            policies: m?.policies ?? 0,
            pk: t.primaryKey.length > 0,
            view: Boolean(t.isView),
            invoker: Boolean(m?.invoker),
          }
        })
      )
    } catch {
      setRows([])
    }
  }, [schema])

  useEffect(() => {
    void load()
    // live sync — RLS toggles / DDL from the table editor or SQL editor show up
    // here within seconds without a manual refresh
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  if (rows === null) return <Spinner />
  const visible = rows.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
  const managed = isManagedSchema(schema)

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Tables"
        description="Every table in the selected schema — size, rows, and Row Level Security posture."
        search={search}
        onSearch={setSearch}
        onRefresh={() => void load()}
        schemaPicker
      />
      {managed && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/40 px-6 py-2 text-xs text-muted-foreground">
          <Lock size={13} className="shrink-0" />
          <span>
            The <span className="font-mono text-foreground/80">{schema}</span> schema is managed by tinbase. It isn't exposed to
            anon/authenticated through the Data API — access is controlled by grants, so tables here don't need RLS policies.
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Rows</Th>
              <Th>Size</Th>
              <Th>RLS</Th>
              <Th>Policies</Th>
              <Th className="w-10" />
            </tr>
          </THead>
          <tbody>
            {visible.map((r) => (
              <TRow key={r.name} className="cursor-pointer" onClick={() => navigate('table', r.name)}>
                <Td className="font-mono text-foreground/90">
                  <span className="flex items-center gap-1.5">
                    {r.view ? (
                      <Eye size={12} className="shrink-0 text-muted-foreground/60" />
                    ) : (
                      <Table2 size={12} className="shrink-0 text-muted-foreground/50" />
                    )}
                    {r.name}
                    {r.view && <Badge variant="neutral">view</Badge>}
                    {!r.pk && !r.view && (
                      <span title="No primary key">
                        <KeyRound size={11} className="text-warning" />
                      </span>
                    )}
                  </span>
                </Td>
                <Td className="tabular-nums text-muted-foreground">{r.rows.toLocaleString()}</Td>
                <Td className="font-mono text-muted-foreground">{r.view ? '—' : r.size}</Td>
                <Td>
                  {r.view ? (
                    r.invoker ? (
                      <span title="security_invoker — the caller's RLS applies through this view">
                        <Badge variant="neutral">invoker</Badge>
                      </span>
                    ) : (
                      <span title={managed ? 'Owner-rights view in a grant-protected schema' : "Runs with the owner's permissions — RLS on the underlying tables is bypassed"}>
                        <Badge variant={managed ? 'neutral' : 'red'}>{managed ? 'definer' : 'unrestricted'}</Badge>
                      </span>
                    )
                  ) : r.rls ? (
                    <Badge variant="brand">enabled</Badge>
                  ) : (
                    <span title={managed ? 'Protected by grants — not exposed through the Data API' : 'RLS is disabled — all rows are exposed to every role'}>
                      <Badge variant={managed ? 'neutral' : 'red'}>disabled</Badge>
                    </span>
                  )}
                </Td>
                <Td className="tabular-nums text-muted-foreground">{r.view ? '—' : r.policies}</Td>
                <Td>
                  <ArrowUpRight size={13} className="text-muted-foreground/60 opacity-0 group-hover:opacity-100" />
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {visible.length === 0 && <Empty>{rows.length === 0 ? 'No tables yet.' : 'No match.'}</Empty>}
      </div>
    </div>
  )
}
