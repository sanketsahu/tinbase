/**
 * `tinbase db diff` core: diff the live project database (which may contain
 * changes made outside migrations) against a fresh "shadow" database that has
 * only the migrations applied. The emitted DDL is the delta you'd save as a
 * new migration.
 */
import { mkdtempSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBackend, type TinbaseBackend } from '../index.js'
import { snapshotSchema, diffSchemas } from '../db/schema-diff.js'
import type { MigrationFile } from '../types.js'

/** Inputs for {@link computeDbDiff}: how to reach the live db plus the migrations that define the shadow. */
export interface DbDiffOptions {
  /** the live project's data dir (wasm) or undefined when a native engine is passed */
  liveDataDir?: string
  /** an already-open live engine; takes precedence over `liveDataDir` when set */
  liveEngine?: import('../db/engine.js').DbEngine
  /** migrations applied to both the shadow and (as pending) the live db before diffing */
  migrations: MigrationFile[]
  /** ignored for diffing (seed is data, not schema); accepted so callers can pass one options bag */
  seedSql?: string
  /** schema to diff; defaults to 'public' */
  schema?: string
  /** factory for the shadow engine (native mode); omit for wasm/in-memory shadow */
  makeShadowEngine?: () => Promise<import('../db/engine.js').DbEngine>
}

/** Compute the DDL delta from the migrations-only shadow db to the current live schema. */
export async function computeDbDiff(opts: DbDiffOptions): Promise<string[]> {
  const schema = opts.schema ?? 'public'

  // shadow = migrations only, fresh
  const shadow: TinbaseBackend = await createBackend({
    engine: opts.makeShadowEngine ? await opts.makeShadowEngine() : undefined,
    migrations: opts.migrations,
    // no seed: seed is data, not schema
  })
  // live = current project db (createBackend only applies *pending* migrations, so
  // this reflects the actual current schema including out-of-migration changes)
  const live: TinbaseBackend = await createBackend({
    engine: opts.liveEngine,
    dataDir: opts.liveEngine ? undefined : opts.liveDataDir,
    migrations: opts.migrations,
  })

  try {
    const shadowSnap = await snapshotSchema(shadow.db, schema)
    const liveSnap = await snapshotSchema(live.db, schema)
    return diffSchemas(shadowSnap, liveSnap, schema)
  } finally {
    await shadow.close()
    await live.close()
  }
}

/** Fresh throwaway data dir for a native-engine shadow database, under the OS temp dir. */
export function shadowNativeDataDir(): string {
  return join(mkdtempSync(join(tmpdir(), 'tinbase-shadow-')), 'pg')
}

/** Inputs for {@link pullSchema}: everything {@link DbDiffOptions} needs plus where/how to write the migration. */
export interface DbPullOptions extends DbDiffOptions {
  /** directory to write the migration into (usually supabase/migrations); omit to skip writing */
  migrationsDir?: string
  /** migration name suffix (default 'remote_schema') */
  name?: string
  /** timestamp version prefix; pass for determinism (default: now as YYYYMMDDHHMMSS) */
  stamp?: string
}

/** Outcome of a {@link pullSchema} run. */
export interface DbPullResult {
  /** the diffed DDL statements; empty when live and migrations already match */
  ddl: string[]
  /** timestamp version recorded for the written migration, or null when nothing was written */
  version: string | null
  /** path of the written migration file, or null when `migrationsDir` was omitted or ddl was empty */
  path: string | null
}

/**
 * `tinbase db pull` core: like `db diff`, but writes the delta as a migration
 * AND records it as already-applied on the live database - the schema is
 * already there, so a subsequent `tinbase start` must not re-run it. This is
 * how you bring an out-of-migration (or externally-created) schema under
 * version control.
 */
export async function pullSchema(opts: DbPullOptions): Promise<DbPullResult> {
  const schema = opts.schema ?? 'public'
  const shadow: TinbaseBackend = await createBackend({
    engine: opts.makeShadowEngine ? await opts.makeShadowEngine() : undefined,
    migrations: opts.migrations,
  })
  const live: TinbaseBackend = await createBackend({
    engine: opts.liveEngine,
    dataDir: opts.liveEngine ? undefined : opts.liveDataDir,
    migrations: opts.migrations,
  })
  try {
    const ddl = diffSchemas(await snapshotSchema(shadow.db, schema), await snapshotSchema(live.db, schema), schema)
    if (ddl.length === 0) return { ddl, version: null, path: null }

    const stamp = opts.stamp ?? new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const name = opts.name ?? 'remote_schema'
    const body = ddl.join('\n\n') + '\n'
    let path: string | null = null
    if (opts.migrationsDir) {
      await mkdir(opts.migrationsDir, { recursive: true })
      path = join(opts.migrationsDir, `${stamp}_${name}.sql`)
      await writeFile(path, body)
    }
    // record as already applied on the live DB so `start` won't re-run it
    await live.db.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3) on conflict (version) do nothing`,
      [stamp, `${stamp}_${name}`, [body]]
    )
    return { ddl, version: stamp, path }
  } finally {
    await shadow.close()
    await live.close()
  }
}
