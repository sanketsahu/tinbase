/**
 * Admin API (/admin/v1/*) backing tinbase studio at /_/.
 * Every endpoint requires the service_role key. This is a thin, introspection-
 * and-SQL surface; row CRUD goes through the normal PostgREST layer (with RLS
 * bypassed by the service_role), so the studio uses the same paths an app does.
 */
import { applyAuthSettingsPatch, saveAuthSettings, type AuthSettings } from '../auth/settings.js'
import { statusForSqlState } from '../rest/errors.js'
import { quoteIdent } from '../db/database.js'
import type { Database } from '../db/database.js'
import { signJwt } from '../jwt.js'
import type { LogBuffer } from '../log-buffer.js'
import type { RequestContext } from '../types.js'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Map any thrown value to an admin error response. Postgres errors get their
 * SQLSTATE-derived status (via PostgREST's mapping) and carry code/detail/hint;
 * everything else is a 500. The `error` field stays a plain string so existing
 * studio callers keep working.
 */
function adminError(e: unknown): Response {
  const pg = e as { code?: string; message?: string; detail?: string; hint?: string }
  if (pg && typeof pg.code === 'string' && /^[0-9A-Z]{5}$/.test(pg.code)) {
    return json(statusForSqlState(pg.code), {
      error: pg.message ?? 'database error',
      code: pg.code,
      detail: pg.detail ?? null,
      hint: pg.hint ?? null,
    })
  }
  return json(500, { error: e instanceof Error ? e.message : String(e) })
}

/** Built-in edge-function vars tinbase injects - read-only, can't be edited/deleted. */
const BUILTIN_SECRETS = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'])

/**
 * SHA-256 digests of every secret value, so the studio can show a stable
 * fingerprint (like hosted Supabase) without ever sending the plaintext of a
 * custom secret back over the wire.
 */
async function secretDigests(env: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    out[name] = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return out
}

/** Studio-facing admin surface: schema introspection, raw SQL, RLS policies, secrets, and auth settings, all gated on the service_role key. */
export class AdminApi {
  constructor(
    private db: Database,
    private logs?: LogBuffer,
    private auth?: { anonKey: string; jwtSecret: string },
    private info?: {
      /** names of loaded edge functions */
      edgeFunctions: string[]
      /** configured OAuth provider ids */
      oauthProviders: string[]
      /** whether the local dev inbox mailer is mounted at /inbox */
      inbox: boolean
      /** statically configured database webhooks */
      webhooks: unknown[]
      /** SHARED runtime auth settings - mutated in place so the auth handler sees changes instantly */
      authSettings?: AuthSettings
      /** env vars injected into edge functions (service_role-only introspection for the studio) */
      functionEnv?: Record<string, string>
    }
  ) {}

  /** Route an /admin/v1/* request to its handler, rejecting any non-service_role caller with a 403. */
  async handle(req: Request, ctx: RequestContext, url: URL): Promise<Response> {
    if (ctx.role !== 'service_role') {
      return json(403, { error: 'admin API requires the service_role key' })
    }
    const path = url.pathname.replace(/^\/admin\/v1\/?/, '')
    const method = req.method.toUpperCase()

    try {
      if (path === 'tables' && method === 'GET') return await this.listTables(url)
      if (path === 'sql' && method === 'POST') return await this.runSql(req)
      if (path === 'stats' && method === 'GET') return await this.stats()
      if (path === 'schemas' && method === 'GET') return await this.schemas()
      if (path === 'migrations' && method === 'GET') return await this.migrations()
      if (path === 'policies' && method === 'GET') return await this.listPolicies(url)
      if (path === 'policies' && method === 'POST') return await this.createPolicy(req)
      if (path === 'policies' && method === 'DELETE') return await this.dropPolicy(url)
      if (path === 'functions' && method === 'GET') return await this.listFunctions(url)
      if (path === 'triggers' && method === 'GET') return await this.listTriggers(url)
      if (path === 'keys' && method === 'GET') return json(200, { anonKey: this.auth?.anonKey ?? null })
      if (path === 'impersonate' && method === 'GET') return await this.impersonate(url)
      if (path === 'edge-functions' && method === 'GET') {
        const env = this.info?.functionEnv ?? {}
        return json(200, {
          functions: this.info?.edgeFunctions ?? [],
          env,
          builtins: [...BUILTIN_SECRETS],
          digests: await secretDigests(env),
        })
      }
      if (path === 'edge-functions/secrets' && method === 'PUT') return await this.putSecrets(req)
      if (path === 'edge-functions/secrets' && method === 'DELETE') return await this.deleteSecret(url)
      if (path === 'auth-config' && method === 'GET') {
        return json(200, {
          providers: this.info?.oauthProviders ?? [],
          inbox: this.info?.inbox ?? false,
          settings: this.info?.authSettings ?? null,
        })
      }
      if (path === 'auth-config' && method === 'PATCH') return await this.patchAuthSettings(req)
      if (path === 'webhooks' && method === 'GET') return json(200, { webhooks: this.info?.webhooks ?? [] })
      if (path === 'logs' && method === 'GET') return json(200, { logs: this.logs?.list() ?? [] })
      if (path === 'logs' && method === 'DELETE') {
        this.logs?.clear()
        return json(200, { ok: true })
      }
      return json(404, { error: `unknown admin endpoint: ${path}` })
    } catch (e) {
      return adminError(e)
    }
  }

  /**
   * Patch the shared runtime auth settings (signups / anonymous / autoconfirm /
   * password length / disabled providers). Mutates the object the auth handler
   * reads on every request - changes apply instantly - and persists it to
   * auth.config so a restart keeps them.
   */
  private async patchAuthSettings(req: Request): Promise<Response> {
    const settings = this.info?.authSettings
    if (!settings) return json(400, { error: 'auth settings are not configured' })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return json(400, { error: 'a JSON object body is required' })
    // only known OAuth providers can be disabled - reject typos outright
    if (Array.isArray(body.disabledProviders)) {
      const known = this.info?.oauthProviders ?? []
      const unknown = body.disabledProviders.filter((p) => !known.includes(p as string))
      if (unknown.length > 0) return json(400, { error: `unknown provider(s): ${unknown.join(', ')}` })
    }
    const err = applyAuthSettingsPatch(settings, body)
    if (err) return json(400, { error: err })
    await saveAuthSettings(this.db, settings)
    return json(200, { settings })
  }

  /**
   * Add or replace edge-function secrets. Mutates the live functionEnv object
   * the Deno shim reads on the next invocation, so changes apply with no
   * restart. This is a runtime store: it is not written back to
   * supabase/functions/.env, so a restart reloads from that file. Built-in
   * SUPABASE_* vars are read-only and cannot be overwritten here.
   *
   * Body: { secrets: { NAME: value, ... } } - names must be valid env keys.
   */
  private async putSecrets(req: Request): Promise<Response> {
    const env = this.info?.functionEnv
    if (!env) return json(400, { error: 'edge functions are not configured' })
    const body = (await req.json().catch(() => null)) as { secrets?: Record<string, unknown> } | null
    const secrets = body?.secrets
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) {
      return json(400, { error: 'body must be { secrets: { NAME: value, ... } }' })
    }
    const names = Object.keys(secrets)
    if (names.length === 0) return json(400, { error: 'at least one secret is required' })
    for (const name of names) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
        return json(400, { error: `invalid secret name "${name}" - use letters, digits, and underscores` })
      }
      if (BUILTIN_SECRETS.has(name)) return json(400, { error: `"${name}" is a built-in and cannot be changed` })
      if (typeof secrets[name] !== 'string') return json(400, { error: `value for "${name}" must be a string` })
    }
    for (const name of names) env[name] = secrets[name] as string
    return json(200, { ok: true, secrets: await secretDigests(env) })
  }

  /** Delete one custom edge-function secret. Built-ins cannot be deleted. */
  private async deleteSecret(url: URL): Promise<Response> {
    const env = this.info?.functionEnv
    if (!env) return json(400, { error: 'edge functions are not configured' })
    const name = url.searchParams.get('name')
    if (!name) return json(400, { error: 'a secret name is required (?name=)' })
    if (BUILTIN_SECRETS.has(name)) return json(400, { error: `"${name}" is a built-in and cannot be deleted` })
    if (!(name in env)) return json(404, { error: `secret "${name}" not found` })
    delete env[name]
    return json(200, { ok: true, secrets: await secretDigests(env) })
  }

  /**
   * Mint a short-lived JWT for role preview in the studio ("view data as anon /
   * authenticated"). Requires the service_role key like every admin endpoint.
   */
  private async impersonate(url: URL): Promise<Response> {
    if (!this.auth) return json(400, { error: 'impersonation is not configured' })
    const role = url.searchParams.get('role') ?? 'anon'
    if (role !== 'anon' && role !== 'authenticated') {
      return json(400, { error: 'role must be anon or authenticated' })
    }
    const now = Math.floor(Date.now() / 1000)
    const claims: Record<string, unknown> = { iss: 'supabase', ref: 'tinbase', role, iat: now, exp: now + 3600 }
    if (role === 'authenticated') {
      const sub = url.searchParams.get('sub')
      if (!sub) return json(400, { error: 'sub (user id) is required for authenticated' })
      claims.sub = sub
      const email = url.searchParams.get('email')
      if (email) claims.email = email
    }
    return json(200, { token: await signJwt(claims, this.auth.jwtSecret), expiresIn: 3600 })
  }

  /** List a schema's tables and views with columns, primary keys, row counts, and outbound foreign keys for the studio table browser. */
  private async listTables(url: URL): Promise<Response> {
    const schema = url.searchParams.get('schema') ?? 'public'
    this.db.invalidateSchemaCache()
    const info = await this.db.getSchemaInfo(schema)
    // information_schema.columns includes views, so flag them - the studio
    // renders views read-only instead of complaining about a missing PK
    const viewRows = await this.db.query<{ table_name: string }>(
      `select table_name from information_schema.views where table_schema = $1`,
      [schema]
    )
    const views = new Set(viewRows.rows.map((v) => v.table_name))
    const tables = []
    for (const t of info.tables.values()) {
      // A single table whose count fails (e.g. an engine gap in an RLS policy's
      // correlated subquery on the pgmem preview engine) must not blank the whole
      // table list - fall back to an unknown count for just that table.
      let count: { rows: { n: number }[] }
      try {
        count = await this.db.query<{ n: number }>(
          `select count(*)::int as n from ${quoteIdent(schema)}.${quoteIdent(t.name)}`
        )
      } catch {
        count = { rows: [{ n: -1 }] }
      }
      // foreign keys originating from this table, for column hints
      const fks = info.foreignKeys
        .filter((fk) => fk.srcSchema === schema && fk.srcTable === t.name)
        .map((fk) => ({ columns: fk.srcColumns, target: `${fk.tgtSchema}.${fk.tgtTable}`, targetColumns: fk.tgtColumns }))
      tables.push({
        name: t.name,
        primaryKey: t.primaryKey,
        rowCount: count.rows[0]?.n ?? 0,
        isView: views.has(t.name),
        foreignKeys: fks,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.udtName,
          nullable: c.isNullable,
          hasDefault: c.hasDefault,
          isPrimaryKey: c.isPrimaryKey,
        })),
      })
    }
    return json(200, { schema, tables })
  }

  /** Run an arbitrary SQL statement from the studio SQL editor, optionally under a SET LOCAL role + JWT claims to preview RLS as anon/authenticated. */
  private async runSql(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
      query?: string
      /** run as this database role (SET ROLE) - studio "run as anon/authenticated" */
      role?: string
      /** JWT claims exposed as request.jwt.claims so auth.uid()/auth.jwt() resolve */
      claims?: Record<string, unknown>
    }
    if (!body.query?.trim()) return json(400, { error: 'query is required' })
    const role = body.role?.trim()
    if (role !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
      return json(400, { error: 'invalid role name' })
    }
    const started = Date.now()
    try {
      // When a role is requested ("run as anon/authenticated"), execute inside a
      // transaction with SET LOCAL role + request.jwt.claims - the same mechanism
      // the REST layer uses - so role/claims never leak onto the shared connection
      // between concurrent requests. The claims value is passed as a bound
      // parameter, not interpolated.
      const res = role
        ? await this.db.withContext({ role, claims: body.claims ?? { role } }, (q) => q(body.query!))
        : await this.db.query(body.query)
      this.db.invalidateSchemaCache()
      return json(200, {
        rows: res.rows.slice(0, 2000),
        rowCount: res.rows.length,
        affectedRows: res.affectedRows ?? null,
        ms: Date.now() - started,
      })
    } catch (e) {
      return adminError(e)
    }
  }

  /** List user-visible schema names (excluding the Postgres catalog schemas). */
  private async schemas(): Promise<Response> {
    const res = await this.db.query<{ name: string }>(
      `select schema_name as name from information_schema.schemata
       where schema_name not in ('pg_catalog','information_schema','pg_toast')
       order by schema_name`
    )
    return json(200, { schemas: res.rows.map((r) => r.name) })
  }

  /** List applied migrations from supabase_migrations.schema_migrations, ordered by version. */
  private async migrations(): Promise<Response> {
    const res = await this.db.query<{ version: string; name: string | null; applied_at: string }>(
      `select version, name, applied_at from supabase_migrations.schema_migrations order by version`
    )
    return json(200, { migrations: res.rows })
  }

  /** List the RLS policies defined in a schema (from pg_policies). */
  private async listPolicies(url: URL): Promise<Response> {
    const schema = url.searchParams.get('schema') ?? 'public'
    const res = await this.db.query(
      `select schemaname as schema, tablename as table, policyname as name,
              cmd, permissive, roles, qual as using_expr, with_check
       from pg_policies where schemaname = $1
       order by tablename, policyname`,
      [schema]
    )
    return json(200, { policies: res.rows })
  }

  /** Create an RLS policy from the studio policy editor, building the CREATE POLICY DDL from the request body. */
  private async createPolicy(req: Request): Promise<Response> {
    const b = (await req.json().catch(() => ({}))) as {
      schema?: string
      table?: string
      name?: string
      command?: string // ALL | SELECT | INSERT | UPDATE | DELETE
      behavior?: string // PERMISSIVE | RESTRICTIVE
      roles?: string
      using?: string
      check?: string
    }
    if (!b.table || !b.name) return json(400, { error: 'table and name are required' })
    const schema = b.schema ?? 'public'
    const cmd = (b.command ?? 'ALL').toUpperCase()
    const behavior = (b.behavior ?? 'PERMISSIVE').toUpperCase()
    if (behavior !== 'PERMISSIVE' && behavior !== 'RESTRICTIVE') {
      return json(400, { error: 'behavior must be PERMISSIVE or RESTRICTIVE' })
    }
    const roles = b.roles?.trim() || 'public'
    let sql = `create policy ${quoteIdent(b.name)} on ${quoteIdent(schema)}.${quoteIdent(b.table)} as ${behavior} for ${cmd} to ${roles}`
    if (b.using?.trim()) sql += ` using (${b.using})`
    if (b.check?.trim()) sql += ` with check (${b.check})`
    try {
      await this.db.query(sql)
      this.db.invalidateSchemaCache()
      return json(200, { ok: true })
    } catch (e) {
      return adminError(e)
    }
  }

  /** Drop an RLS policy by schema/table/name. */
  private async dropPolicy(url: URL): Promise<Response> {
    const schema = url.searchParams.get('schema') ?? 'public'
    const table = url.searchParams.get('table')
    const name = url.searchParams.get('name')
    if (!table || !name) return json(400, { error: 'table and name are required' })
    try {
      await this.db.query(`drop policy ${quoteIdent(name)} on ${quoteIdent(schema)}.${quoteIdent(table)}`)
      this.db.invalidateSchemaCache()
      return json(200, { ok: true })
    } catch (e) {
      return adminError(e)
    }
  }

  /** List a schema's SQL functions with signatures, language, and source body. */
  private async listFunctions(url: URL): Promise<Response> {
    const schema = url.searchParams.get('schema') ?? 'public'
    const res = await this.db.query(
      `select p.proname as name,
              pg_get_function_identity_arguments(p.oid) as args,
              t.typname as returns, l.lanname as language,
              p.prosecdef as security_definer,
              p.prosrc as body
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype
       join pg_language l on l.oid = p.prolang
       where n.nspname = $1 and p.prokind = 'f'
       order by p.proname`,
      [schema]
    )
    return json(200, { functions: res.rows })
  }

  /** List a schema's user triggers with timing and events, decoded from pg_trigger's tgtype bitmask. */
  private async listTriggers(url: URL): Promise<Response> {
    const schema = url.searchParams.get('schema') ?? 'public'
    const res = await this.db.query(
      `select tg.tgname as name, c.relname as table,
              case when (tg.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end as timing,
              array_remove(array[
                case when (tg.tgtype & 4) <> 0 then 'INSERT' end,
                case when (tg.tgtype & 8) <> 0 then 'DELETE' end,
                case when (tg.tgtype & 16) <> 0 then 'UPDATE' end], null) as events,
              p.proname as function
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = tg.tgfoid
       where n.nspname = $1 and not tg.tgisinternal
       order by c.relname, tg.tgname`,
      [schema]
    )
    return json(200, { triggers: res.rows })
  }

  /** Summary counts (users, buckets, objects, migrations, tables) plus database size and version for the studio dashboard. */
  private async stats(): Promise<Response> {
    const one = async (sql: string) => (await this.db.query<{ n: number }>(sql)).rows[0]?.n ?? 0
    const users = await one(`select count(*)::int as n from auth.users`)
    const buckets = await one(`select count(*)::int as n from storage.buckets`)
    const objects = await one(`select count(*)::int as n from storage.objects`)
    const migrations = await one(`select count(*)::int as n from supabase_migrations.schema_migrations`)
    const tables = await one(
      `select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`
    )
    const size = await this.db.query<{ s: string; v: string }>(
      `select pg_size_pretty(pg_database_size(current_database())) as s, version() as v`
    )
    return json(200, {
      users,
      buckets,
      objects,
      migrations,
      tables,
      dbSize: size.rows[0]?.s ?? '?',
      version: (size.rows[0]?.v ?? '').split(' on ')[0],
    })
  }
}
