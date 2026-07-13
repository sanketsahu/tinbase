/** Loads migrations + seed following Supabase CLI conventions (supabase/ dir). */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MigrationFile } from '../types.js'

export interface SupabaseProject {
  migrations: MigrationFile[]
  seedSql?: string
}

/** Seed config from config.toml [db.seed] (enabled + explicit file paths). */
export interface SeedOptions {
  enabled?: boolean
  /** Files relative to supabase/, applied in order. Defaults to ['seed.sql']. Globs are not expanded. */
  paths?: string[]
}

export async function loadSupabaseProject(projectDir: string, seed: SeedOptions = {}): Promise<SupabaseProject> {
  const migrationsDir = join(projectDir, 'supabase', 'migrations')
  const migrations: MigrationFile[] = []

  let entries: string[] = []
  try {
    entries = await readdir(migrationsDir)
  } catch {
    // no migrations directory — that's fine
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
        // missing seed file — skip
      }
    }
    if (parts.length) seedSql = parts.join('\n')
  }

  return { migrations, seedSql }
}
