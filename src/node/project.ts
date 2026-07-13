/** Loads migrations + seed following Supabase CLI conventions (supabase/ dir). */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MigrationFile } from '../types.js'

/** Migrations and optional seed SQL discovered under a project's supabase/ dir. */
export interface SupabaseProject {
  /** Migrations in filename order (timestamp-prefixed, so lexical == chronological). */
  migrations: MigrationFile[]
  /** Concatenated seed files, if any were found and seeding is enabled. */
  seedSql?: string
}

/** Seed config from config.toml [db.seed] (enabled + explicit file paths). */
export interface SeedOptions {
  /** whether seeding runs; only `false` disables it (undefined means enabled) */
  enabled?: boolean
  /** Files relative to supabase/, applied in order. Defaults to ['seed.sql']. Globs are not expanded. */
  paths?: string[]
}

/**
 * Read supabase/migrations/*.sql (sorted) and, unless disabled, the configured
 * seed files. A missing migrations dir or seed file is not an error.
 */
export async function loadSupabaseProject(projectDir: string, seed: SeedOptions = {}): Promise<SupabaseProject> {
  const migrationsDir = join(projectDir, 'supabase', 'migrations')
  const migrations: MigrationFile[] = []

  let entries: string[] = []
  try {
    entries = await readdir(migrationsDir)
  } catch {
    // no migrations directory - that's fine
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.sql')) continue
    const sql = await readFile(join(migrationsDir, entry), 'utf8')
    migrations.push({ name: entry.replace(/\.sql$/, ''), sql })
  }

  let seedSql: string | undefined
  if (seed.enabled !== false) {
    const paths = (seed.paths ?? ['seed.sql']).filter((p) => !/[*?[\]]/.test(p)) // globs unsupported; skip them
    const parts: string[] = []
    for (const rel of paths) {
      try {
        parts.push(await readFile(join(projectDir, 'supabase', rel), 'utf8'))
      } catch {
        // missing seed file - skip
      }
    }
    if (parts.length) seedSql = parts.join('\n')
  }

  return { migrations, seedSql }
}
