import { ChevronLeft, ChevronRight, Eye, FunctionSquare, Gauge, HardDrive, Inbox, KeyRound, Lightbulb, Package, ShieldAlert, Table2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { navigate } from '../lib/router'
import { Badge, Button, Select, Sheet, SheetClose, Spinner, Tabs, type BadgeVariant } from './ui'

/* ── findings engine ─────────────────────────────────────────────────────────
 * Local implementation of Supabase's database-advisor lints
 * (https://supabase.com/docs/guides/database/database-advisors), derived live
 * from pg_catalog — no stored state.
 *
 * Implemented: 0001 unindexed fks · 0002 auth users exposed · 0003 auth rls
 * initplan · 0004 no primary key · 0006 multiple permissive policies · 0007
 * policy exists rls disabled · 0008 rls enabled no policy · 0009 duplicate
 * index · 0010 security definer view · 0011 function search path mutable ·
 * 0012 anonymous sign-ins · 0013 rls disabled in public · 0014 extension in
 * public · 0015 rls references user metadata · 0016 materialized view in api ·
 * 0017 foreign table in api · 0018 unsupported reg types · 0019 insecure
 * queue exposed · 0023 sensitive columns · 0024 permissive rls policy · 0025
 * public bucket allows listing · 0028/0029 secdef function executable.
 *
 * Not applicable to a local stack (deliberately skipped): 0005 unused index
 * (planner stats are meaningless on a fresh dev db), 0020 table bloat (no
 * autovacuum stats), 0021 fkey-to-auth-unique (Postgres already enforces
 * unique FK targets), 0022 extension versions (needs a remote catalog),
 * 0026/0027 pg_graphql exposure (tinbase does not ship pg_graphql).        */

export type FindingLevel = 'critical' | 'warning' | 'info'
export type FindingCategory = 'security' | 'performance'

export interface Finding {
  id: string
  /** Supabase lint code (e.g. `0013`) so findings map 1:1 to the published catalog */
  code: string
  category: FindingCategory
  level: FindingLevel
  title: string
  /** qualified entity, e.g. `public.orders` or `Auth` */
  entity: string
  entityKind: 'table' | 'view' | 'function' | 'auth' | 'storage' | 'queue' | 'extension'
  issue: ReactNode
  description: string
  action: { label: string; go: () => void }
}

const Mono = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-accent px-1 py-px font-mono text-[12px] text-foreground/90">{children}</code>
)

const AUTH_FN = /auth\.(uid|jwt|role|email)\(\)/i
const WRAPPED = /\(\s*select\s+(auth\.|current_setting)/i

/** Run all lints; failures of one lint never hide the others. */
export async function fetchFindings(): Promise<Finding[]> {
  const [tables, definerViews, fks, authViews, policies, dupIdx, fns, exts, relKinds, regCols, sensCols, queues, buckets, storagePolicies, auth] =
    await Promise.allSettled([
      api.sql(
        `select c.relname as name, c.relrowsecurity as rls,
                exists(select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary) as has_pk,
                (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by c.relname`
      ),
      api.sql(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'v'
           and not coalesce('security_invoker=true' = any(c.reloptions) or 'security_invoker=on' = any(c.reloptions), false)
         order by c.relname`
      ),
      api.sql(
        `select con.conname as name, cl.relname as tbl, a.attname as col
         from pg_constraint con
         join pg_class cl on cl.oid = con.conrelid
         join pg_namespace n on n.oid = cl.relnamespace
         join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
         where con.contype = 'f' and n.nspname = 'public'
           and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1])
         order by cl.relname, con.conname`
      ),
      api.sql(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('v','m') and pg_get_viewdef(c.oid) ilike '%auth.users%'
         order by c.relname`
      ),
      api.sql(
        `select tablename as tbl, policyname as name, cmd, permissive, roles::text[] as roles,
                coalesce(qual, '') as qual, coalesce(with_check, '') as check
         from pg_policies where schemaname = 'public' order by tablename, policyname`
      ),
      api.sql(
        `select cl.relname as tbl, array_agg(ic.relname order by ic.relname) as idxs
         from pg_index i
         join pg_class cl on cl.oid = i.indrelid
         join pg_class ic on ic.oid = i.indexrelid
         join pg_namespace n on n.oid = cl.relnamespace
         where n.nspname = 'public'
         group by cl.relname, i.indkey, i.indclass,
                  coalesce(pg_get_expr(i.indexprs, i.indrelid), ''), coalesce(pg_get_expr(i.indpred, i.indrelid), '')
         having count(*) > 1`
      ),
      api.sql(
        `select p.proname as name, p.prosecdef as secdef,
                (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')) as mutable_path,
                has_function_privilege('anon', p.oid, 'execute') as anon_exec,
                has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f' order by p.proname`
      ),
      api.sql(
        `select e.extname as name from pg_extension e join pg_namespace n on n.oid = e.extnamespace
         where n.nspname = 'public' order by e.extname`
      ),
      api.sql(
        `select c.relname as name, c.relkind as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('m','f') order by c.relname`
      ),
      api.sql(
        `select table_name as tbl, column_name as col, udt_name as typ from information_schema.columns
         where table_schema = 'public' and udt_name in
           ('regclass','regcollation','regconfig','regdictionary','regnamespace','regoper','regoperator','regproc','regprocedure','regrole')
         order by table_name, column_name`
      ),
      api.sql(
        `select table_name as tbl, column_name as col from information_schema.columns
         where table_schema = 'public'
           and column_name ~* '(password|passwd|secret|api_key|apikey|access_token|refresh_token|private_key|ssn|credit_card)'
         order by table_name, column_name`
      ),
      api.sql(
        `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'pgmq' and c.relkind = 'r' and c.relname like 'q\\_%'
           and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
         order by c.relname`
      ),
      api.sql(`select id from storage.buckets where public order by id`),
      api.sql(
        `select policyname as name, cmd, roles::text[] as roles, coalesce(qual, '') as qual
         from pg_policies where schemaname = 'storage' and tablename = 'objects'`
      ),
      api.authConfig(),
    ])

  const out: Finding[] = []
  const rows = <T,>(r: PromiseSettledResult<{ ok: boolean; rows?: unknown[] }>): T[] =>
    r.status === 'fulfilled' && r.value.ok ? ((r.value.rows ?? []) as T[]) : []

  /* 0013 rls disabled · 0007 policy exists rls disabled · 0008 no policy · 0004 no pk */
  for (const t of rows<{ name: string; rls: boolean; has_pk: boolean; policies: number }>(tables)) {
    if (!t.rls) {
      out.push({
        id: `0013:${t.name}`,
        code: '0013',
        category: 'security',
        level: 'critical',
        title: 'RLS Disabled in Public',
        entity: `public.${t.name}`,
        entityKind: 'table',
        issue: (
          <>
            Table <Mono>public.{t.name}</Mono> is exposed through the Data API with Row Level Security disabled — anon and
            authenticated can read and write every row.
          </>
        ),
        description: 'Detects tables in the public schema without RLS. Public-schema tables are reachable over /rest/v1, so RLS is the row-level access control.',
        action: { label: 'Enable RLS', go: () => navigate('table', t.name) },
      })
      if (t.policies > 0) {
        out.push({
          id: `0007:${t.name}`,
          code: '0007',
          category: 'security',
          level: 'critical',
          title: 'Policy Exists RLS Disabled',
          entity: `public.${t.name}`,
          entityKind: 'table',
          issue: (
            <>
              Table <Mono>public.{t.name}</Mono> has {t.policies} RLS {t.policies === 1 ? 'policy' : 'policies'} but RLS itself is
              disabled — the policies are written but not enforced.
            </>
          ),
          description: 'Detects tables where policies exist while row level security is disabled, so none of them apply.',
          action: { label: 'Enable RLS', go: () => navigate('table', t.name) },
        })
      }
    } else if (t.policies === 0) {
      out.push({
        id: `0008:${t.name}`,
        code: '0008',
        category: 'security',
        level: 'warning',
        title: 'RLS Enabled No Policy',
        entity: `public.${t.name}`,
        entityKind: 'table',
        issue: (
          <>
            Table <Mono>public.{t.name}</Mono> has RLS enabled but no policies — anon and authenticated queries return zero rows,
            which usually surfaces as an app bug.
          </>
        ),
        description: 'Detects tables with Row Level Security enabled but no policy granting any access.',
        action: { label: 'Create policy', go: () => navigate('table', t.name) },
      })
    }
    if (!t.has_pk) {
      out.push({
        id: `0004:${t.name}`,
        code: '0004',
        category: 'performance',
        level: 'warning',
        title: 'No Primary Key',
        entity: `public.${t.name}`,
        entityKind: 'table',
        issue: (
          <>
            Table <Mono>public.{t.name}</Mono> has no primary key — rows can't be uniquely addressed, so updates and deletes
            through the API and the table editor are disabled.
          </>
        ),
        description: 'Detects tables without a primary key. Replication, upserts, and row addressing all require one.',
        action: { label: 'Open table', go: () => navigate('table', t.name) },
      })
    }
  }

  /* 0010 security definer view */
  for (const v of rows<{ name: string }>(definerViews)) {
    out.push({
      id: `0010:${v.name}`,
      code: '0010',
      category: 'security',
      level: 'critical',
      title: 'Security Definer View',
      entity: `public.${v.name}`,
      entityKind: 'view',
      issue: (
        <>
          View <Mono>public.{v.name}</Mono> is defined with the SECURITY DEFINER property.
        </>
      ),
      description:
        'Detects views defined with the SECURITY DEFINER property. These views enforce Postgres permissions and row level security policies (RLS) of the view creator, rather than that of the querying user.',
      action: { label: 'Review view', go: () => navigate('table', v.name) },
    })
  }

  /* 0002 auth users exposed */
  for (const v of rows<{ name: string }>(authViews)) {
    out.push({
      id: `0002:${v.name}`,
      code: '0002',
      category: 'security',
      level: 'critical',
      title: 'Auth Users Exposed',
      entity: `public.${v.name}`,
      entityKind: 'view',
      issue: (
        <>
          <Mono>public.{v.name}</Mono> selects from <Mono>auth.users</Mono> and is exposed through the Data API — user records
          (emails, metadata) may leak to anon/authenticated.
        </>
      ),
      description: 'Detects views or materialized views in an API-exposed schema that read auth.users.',
      action: { label: 'Review view', go: () => navigate('table', v.name) },
    })
  }

  /* 0001 unindexed foreign keys */
  for (const f of rows<{ name: string; tbl: string; col: string }>(fks)) {
    out.push({
      id: `0001:${f.name}`,
      code: '0001',
      category: 'performance',
      level: 'info',
      title: 'Unindexed foreign keys',
      entity: `public.${f.tbl}`,
      entityKind: 'table',
      issue: (
        <>
          Table <Mono>public.{f.tbl}</Mono> has a foreign key <Mono>{f.name}</Mono> on <Mono>{f.col}</Mono> without a covering
          index. This can lead to suboptimal query performance.
        </>
      ),
      description: 'Identifies foreign key constraints without a covering index, which can impact database performance.',
      action: { label: 'Create an index', go: () => navigate('database', 'indexes') },
    })
  }

  /* 0003 initplan · 0006 multiple permissive · 0015 user metadata · 0024 allow-all writes */
  const pols = rows<{ tbl: string; name: string; cmd: string; permissive: string; roles: string[]; qual: string; check: string }>(policies)
  const permissiveGroups = new Map<string, number>()
  for (const p of pols) {
    const expr = `${p.qual} ${p.check}`
    if ((AUTH_FN.test(expr) || /current_setting\(/i.test(expr)) && !WRAPPED.test(expr)) {
      out.push({
        id: `0003:${p.tbl}:${p.name}`,
        code: '0003',
        category: 'performance',
        level: 'warning',
        title: 'Auth RLS Initialization Plan',
        entity: `public.${p.tbl}`,
        entityKind: 'table',
        issue: (
          <>
            Policy <Mono>{p.name}</Mono> on <Mono>public.{p.tbl}</Mono> re-evaluates <Mono>auth.&lt;function&gt;()</Mono> or{' '}
            <Mono>current_setting()</Mono> for each row. Replace <Mono>auth.uid()</Mono> with <Mono>(select auth.uid())</Mono> so
            it runs once per query.
          </>
        ),
        description: 'Detects if calls to current_setting() and auth.<function>() in RLS policies are being unnecessarily re-evaluated for each row.',
        action: { label: 'View policies', go: () => navigate('table', p.tbl) },
      })
    }
    if (/user_metadata|raw_user_meta_data/i.test(expr)) {
      out.push({
        id: `0015:${p.tbl}:${p.name}`,
        code: '0015',
        category: 'security',
        level: 'critical',
        title: 'RLS References User Metadata',
        entity: `public.${p.tbl}`,
        entityKind: 'table',
        issue: (
          <>
            Policy <Mono>{p.name}</Mono> on <Mono>public.{p.tbl}</Mono> references user metadata, which end users can edit about
            themselves — it must never gate access.
          </>
        ),
        description: 'Detects RLS policies that reference user_metadata; use app_metadata or your own tables for authorization data.',
        action: { label: 'View policies', go: () => navigate('table', p.tbl) },
      })
    }
    if (
      String(p.permissive).toUpperCase() === 'PERMISSIVE' &&
      ['INSERT', 'UPDATE', 'DELETE', 'ALL'].includes(p.cmd?.toUpperCase()) &&
      (p.qual.trim() === 'true' || p.check.trim() === 'true')
    ) {
      out.push({
        id: `0024:${p.tbl}:${p.name}`,
        code: '0024',
        category: 'security',
        level: 'warning',
        title: 'Permissive RLS Policy',
        entity: `public.${p.tbl}`,
        entityKind: 'table',
        issue: (
          <>
            Policy <Mono>{p.name}</Mono> on <Mono>public.{p.tbl}</Mono> allows {p.cmd} with a bare <Mono>true</Mono> expression —
            every matching role can write unconditionally.
          </>
        ),
        description: 'Detects write policies whose expression is a constant true, granting unrestricted access.',
        action: { label: 'View policies', go: () => navigate('table', p.tbl) },
      })
    }
    if (String(p.permissive).toUpperCase() === 'PERMISSIVE') {
      for (const role of p.roles) {
        const k = `${p.tbl}|${p.cmd}|${role}`
        permissiveGroups.set(k, (permissiveGroups.get(k) ?? 0) + 1)
      }
    }
  }
  for (const [k, n] of permissiveGroups) {
    if (n > 1) {
      const [tbl, cmd, role] = k.split('|')
      out.push({
        id: `0006:${k}`,
        code: '0006',
        category: 'performance',
        level: 'warning',
        title: 'Multiple Permissive Policies',
        entity: `public.${tbl}`,
        entityKind: 'table',
        issue: (
          <>
            Table <Mono>public.{tbl}</Mono> has {n} permissive policies for role <Mono>{role}</Mono> on {cmd} — every policy runs
            for every relevant query.
          </>
        ),
        description: 'Detects multiple permissive policies for the same role and command, which multiplies policy evaluation cost.',
        action: { label: 'View policies', go: () => navigate('table', tbl) },
      })
    }
  }

  /* 0009 duplicate index */
  for (const d of rows<{ tbl: string; idxs: string[] }>(dupIdx)) {
    out.push({
      id: `0009:${d.tbl}:${d.idxs.join(',')}`,
      code: '0009',
      category: 'performance',
      level: 'warning',
      title: 'Duplicate Index',
      entity: `public.${d.tbl}`,
      entityKind: 'table',
      issue: (
        <>
          Table <Mono>public.{d.tbl}</Mono> has identical indexes: <Mono>{d.idxs.join(', ')}</Mono> — every extra copy slows
          writes for no read benefit.
        </>
      ),
      description: 'Detects indexes with identical columns, operator classes, expressions and predicates.',
      action: { label: 'View indexes', go: () => navigate('database', 'indexes') },
    })
  }

  /* 0011 mutable search_path · 0028/0029 executable secdef functions */
  for (const f of rows<{ name: string; secdef: boolean; mutable_path: boolean; anon_exec: boolean; auth_exec: boolean }>(fns)) {
    if (f.mutable_path) {
      out.push({
        id: `0011:${f.name}`,
        code: '0011',
        category: 'security',
        level: 'warning',
        title: 'Function Search Path Mutable',
        entity: `public.${f.name}()`,
        entityKind: 'function',
        issue: (
          <>
            Function <Mono>public.{f.name}()</Mono> does not pin <Mono>search_path</Mono> — a caller-controlled search_path can
            make it resolve unexpected objects. Add <Mono>set search_path = ''</Mono> (or the schemas it needs).
          </>
        ),
        description: 'Detects functions without a fixed search_path configuration parameter.',
        action: { label: 'View functions', go: () => navigate('database', 'functions') },
      })
    }
    if (f.secdef && f.anon_exec) {
      out.push({
        id: `0028:${f.name}`,
        code: '0028',
        category: 'security',
        level: 'warning',
        title: 'Anon Can Execute SECURITY DEFINER Function',
        entity: `public.${f.name}()`,
        entityKind: 'function',
        issue: (
          <>
            <Mono>public.{f.name}()</Mono> runs with its owner's privileges and is executable by <Mono>anon</Mono> — any
            unauthenticated caller inherits those rights for the duration of the call.
          </>
        ),
        description: 'Detects SECURITY DEFINER functions executable by the anon role.',
        action: { label: 'View functions', go: () => navigate('database', 'functions') },
      })
    }
    if (f.secdef && f.auth_exec) {
      out.push({
        id: `0029:${f.name}`,
        code: '0029',
        category: 'security',
        level: 'info',
        title: 'Signed-In Users Can Execute SECURITY DEFINER Function',
        entity: `public.${f.name}()`,
        entityKind: 'function',
        issue: (
          <>
            <Mono>public.{f.name}()</Mono> runs with its owner's privileges and is executable by <Mono>authenticated</Mono>. Often
            intentional (policy helpers) — keep the body minimal and pin <Mono>search_path</Mono>.
          </>
        ),
        description: 'Detects SECURITY DEFINER functions executable by signed-in users.',
        action: { label: 'View functions', go: () => navigate('database', 'functions') },
      })
    }
  }

  /* 0014 extension in public */
  for (const e of rows<{ name: string }>(exts)) {
    out.push({
      id: `0014:${e.name}`,
      code: '0014',
      category: 'security',
      level: 'warning',
      title: 'Extension in Public',
      entity: `public.${e.name}`,
      entityKind: 'extension',
      issue: (
        <>
          Extension <Mono>{e.name}</Mono> is installed in the public schema. Move it to another schema (e.g.{' '}
          <Mono>extensions</Mono>).
        </>
      ),
      description: 'Detects extensions installed in the public schema.',
      action: { label: 'Open SQL editor', go: () => navigate('sql') },
    })
  }

  /* 0016 materialized view in api · 0017 foreign table in api */
  for (const r of rows<{ name: string; kind: string }>(relKinds)) {
    const isMat = r.kind === 'm'
    out.push({
      id: `${isMat ? '0016' : '0017'}:${r.name}`,
      code: isMat ? '0016' : '0017',
      category: 'security',
      level: 'critical',
      title: isMat ? 'Materialized View in API' : 'Foreign Table in API',
      entity: `public.${r.name}`,
      entityKind: 'view',
      issue: (
        <>
          <Mono>public.{r.name}</Mono> is a {isMat ? 'materialized view' : 'foreign table'} in an API-exposed schema —{' '}
          {isMat ? 'materialized views' : 'foreign tables'} do not enforce RLS, so every role can read all of it.
        </>
      ),
      description: isMat
        ? 'Detects materialized views in API-exposed schemas; they cannot have RLS policies.'
        : 'Detects foreign tables in API-exposed schemas; they do not respect RLS.',
      action: { label: 'Open SQL editor', go: () => navigate('sql') },
    })
  }

  /* 0018 unsupported reg types */
  for (const c of rows<{ tbl: string; col: string; typ: string }>(regCols)) {
    out.push({
      id: `0018:${c.tbl}.${c.col}`,
      code: '0018',
      category: 'performance',
      level: 'info',
      title: 'Unsupported reg types',
      entity: `public.${c.tbl}`,
      entityKind: 'table',
      issue: (
        <>
          Column <Mono>{c.col}</Mono> on <Mono>public.{c.tbl}</Mono> uses <Mono>{c.typ}</Mono> — reg* types store OIDs that break
          across dump/restore and upgrades.
        </>
      ),
      description: 'Detects columns using reg* types (except regtype/regrole handled by tooling), which are not supported by backups and upgrades.',
      action: { label: 'Open table', go: () => navigate('table', c.tbl) },
    })
  }

  /* 0023 sensitive columns exposed */
  for (const c of rows<{ tbl: string; col: string }>(sensCols)) {
    out.push({
      id: `0023:${c.tbl}.${c.col}`,
      code: '0023',
      category: 'security',
      level: 'info',
      title: 'Sensitive Columns Exposed',
      entity: `public.${c.tbl}`,
      entityKind: 'table',
      issue: (
        <>
          Column <Mono>{c.col}</Mono> on <Mono>public.{c.tbl}</Mono> looks like it holds a secret. Public-schema columns are
          selectable through the Data API — keep secrets out of exposed tables or lock them down with policies/column grants.
        </>
      ),
      description: 'Heuristically detects likely-sensitive column names (password, token, api_key, …) in API-exposed tables.',
      action: { label: 'Open table', go: () => navigate('table', c.tbl) },
    })
  }

  /* 0019 insecure queue exposed */
  for (const q of rows<{ name: string }>(queues)) {
    out.push({
      id: `0019:${q.name}`,
      code: '0019',
      category: 'security',
      level: 'critical',
      title: 'Insecure Queue Exposed',
      entity: `pgmq.${q.name}`,
      entityKind: 'queue',
      issue: (
        <>
          Queue table <Mono>pgmq.{q.name}</Mono> is readable by anon/authenticated — queue payloads often carry internal data.
          Revoke those grants.
        </>
      ),
      description: 'Detects pgmq queue tables granted to API roles.',
      action: { label: 'Open queues', go: () => navigate('automations', 'queues') },
    })
  }

  /* 0025 public bucket allows listing */
  {
    const pubBuckets = rows<{ id: string }>(buckets)
    const sPols = rows<{ name: string; cmd: string; roles: string[]; qual: string }>(storagePolicies)
    const broadAnonSelect = sPols.some(
      (p) => ['SELECT', 'ALL'].includes(p.cmd?.toUpperCase()) && p.roles.some((r) => r === 'anon' || r === 'public') && !/bucket_id/.test(p.qual)
    )
    if (broadAnonSelect) {
      for (const b of pubBuckets) {
        out.push({
          id: `0025:${b.id}`,
          code: '0025',
          category: 'security',
          level: 'info',
          title: 'Public Bucket Allows Listing',
          entity: `storage.${b.id}`,
          entityKind: 'storage',
          issue: (
            <>
              Bucket <Mono>{b.id}</Mono> is public and an anon SELECT policy on <Mono>storage.objects</Mono> has no{' '}
              <Mono>bucket_id</Mono> filter — anyone can enumerate its file names.
            </>
          ),
          description: 'Detects public buckets whose object-listing policy is not scoped, allowing enumeration of contents.',
          action: { label: 'Open bucket policies', go: () => navigate('storage', b.id) },
        })
      }
    }
  }

  /* 0012 anonymous sign-ins enabled */
  if (auth.status === 'fulfilled' && auth.value.settings?.anonymousUsers) {
    out.push({
      id: '0012',
      code: '0012',
      category: 'security',
      level: 'info',
      title: 'Auth Allow Anonymous Sign-ins',
      entity: 'Auth',
      entityKind: 'auth',
      issue: (
        <>
          Anonymous sign-ins are enabled — anyone can mint an <Mono>authenticated</Mono> session without credentials. Make sure
          RLS policies distinguish anonymous users where it matters.
        </>
      ),
      description: 'Detects when anonymous sign-ins are enabled, since anonymous users hold the authenticated role.',
      action: { label: 'Open auth settings', go: () => navigate('auth', 'providers') },
    })
  }

  const rank: Record<FindingLevel, number> = { critical: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level] || a.code.localeCompare(b.code) || a.entity.localeCompare(b.entity))
}

/* ── global open/close pubsub ── */

let openListener: (() => void) | null = null
/** Open the Advisor sheet from anywhere (header button, home "view all"). */
export function openAdvisor() {
  openListener?.()
}

/* ── presentation ── */

const LEVEL_BADGE: Record<FindingLevel, BadgeVariant> = { critical: 'red', warning: 'amber', info: 'neutral' }
const KIND_ICON = {
  table: Table2,
  view: Eye,
  function: FunctionSquare,
  auth: KeyRound,
  storage: HardDrive,
  queue: Inbox,
  extension: Package,
} as const

function LevelIcon({ f }: { f: Finding }) {
  const cls = f.level === 'critical' ? 'text-destructive' : f.level === 'warning' ? 'text-warning' : 'text-muted-foreground/70'
  return f.category === 'security' ? <ShieldAlert size={15} className={cls} /> : <Gauge size={15} className={cls} />
}

/** Header lightbulb with a severity dot; opens the global Advisor sheet. */
export function AdvisorButton() {
  const [worst, setWorst] = useState<FindingLevel | null>(null)

  useEffect(() => {
    let alive = true
    const load = () =>
      fetchFindings().then((fs) => {
        if (!alive) return
        setWorst(
          fs.some((f) => f.level === 'critical') ? 'critical' : fs.some((f) => f.level === 'warning') ? 'warning' : fs.length ? 'info' : null
        )
      }, () => {})
    void load()
    const t = setInterval(load, 300_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  return (
    <button
      title="Advisor"
      onClick={openAdvisor}
      className="relative flex size-7 items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Lightbulb size={14} />
      {worst && worst !== 'info' && (
        <span
          className={
            'absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-card ' +
            (worst === 'critical' ? 'bg-destructive' : 'bg-warning')
          }
        />
      )}
    </button>
  )
}

/** Mount once in App: hosts the globally openable Advisor sheet. */
export function AdvisorHost() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    openListener = () => setOpen(true)
    return () => {
      openListener = null
    }
  }, [])

  if (!open) return null
  return <AdvisorSheet onClose={() => setOpen(false)} />
}

function AdvisorSheet({ onClose }: { onClose: () => void }) {
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [category, setCategory] = useState<'all' | FindingCategory>('all')
  const [level, setLevel] = useState<'' | FindingLevel>('')
  const [selected, setSelected] = useState<Finding | null>(null)

  const load = useCallback(() => {
    fetchFindings().then(setFindings, () => setFindings([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = (findings ?? []).filter((f) => (category === 'all' || f.category === category) && (!level || f.level === level))

  return (
    <Sheet open onClose={onClose} flush hideHeader width="w-135" title="Advisor">
      <div className="flex h-full flex-col">
        {/* header — list or drill-in */}
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
          {selected ? (
            <>
              <button
                className="rounded p-1 text-muted-foreground/80 hover:bg-accent hover:text-foreground"
                onClick={() => setSelected(null)}
              >
                <ChevronLeft size={16} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-foreground">{selected.title}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground/70">{selected.entity}</p>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/50">{selected.code}</span>
              <Badge variant={LEVEL_BADGE[selected.level]}>{selected.level.toUpperCase()}</Badge>
            </>
          ) : (
            <>
              <Lightbulb size={15} className="text-muted-foreground" />
              <p className="flex-1 text-[14px] font-medium text-foreground">Advisor</p>
            </>
          )}
          <SheetClose asChild>
            <button className="rounded p-1 text-muted-foreground/80 hover:bg-accent hover:text-foreground">✕</button>
          </SheetClose>
        </div>

        {selected ? (
          /* ── detail ── */
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-foreground">Entity</p>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 font-mono text-[12px] text-foreground/90">
                {(() => {
                  const Icon = KIND_ICON[selected.entityKind]
                  return <Icon size={12} className="text-muted-foreground" />
                })()}
                {selected.entity}
              </span>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-foreground">Issue</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{selected.issue}</p>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-foreground">Description</p>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{selected.description}</p>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-semibold text-foreground">Resolve</p>
              <Button
                variant="outline"
                onClick={() => {
                  selected.action.go()
                  onClose()
                }}
              >
                {selected.action.label}
              </Button>
            </div>
          </div>
        ) : (
          /* ── list ── */
          <>
            <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 pt-1.5">
              <Tabs
                tabs={[
                  { id: 'all', label: 'All' },
                  { id: 'security', label: 'Security' },
                  { id: 'performance', label: 'Performance' },
                ]}
                active={category}
                onSelect={(id) => setCategory(id as typeof category)}
              />
              <div className="ml-auto pb-1.5">
                <Select
                  size="xs"
                  className="w-28 shrink-0"
                  value={level}
                  onValueChange={(v) => setLevel(v as typeof level)}
                  options={[
                    { value: '', label: 'Severity' },
                    { value: 'critical', label: 'Critical' },
                    { value: 'warning', label: 'Warning' },
                    { value: 'info', label: 'Info' },
                  ]}
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {findings === null ? (
                <div className="p-5">
                  <Spinner />
                </div>
              ) : visible.length === 0 ? (
                <p className="px-5 py-10 text-center text-[13px] text-muted-foreground/70">
                  {findings.length === 0 ? 'No advisor findings — everything looks healthy.' : 'Nothing matches the filters.'}
                </p>
              ) : (
                visible.map((f) => (
                  <button
                    key={f.id}
                    className="flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/40"
                    onClick={() => setSelected(f)}
                  >
                    <LevelIcon f={f} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{f.title}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground/70">{f.entity}</span>
                    </span>
                    {f.level === 'critical' && <Badge variant="red">CRITICAL</Badge>}
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground/50" />
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
