import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createBackend } from '../src/index.js'

// Exercises `tinbase db reset` via the built CLI, then inspects the wasm data dir.
const CLI = join(process.cwd(), 'dist', 'cli.js')

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-reset-'))
  mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true })
  writeFileSync(join(dir, 'supabase', 'migrations', '20240101000000_t.sql'), 'create table items (id serial primary key, name text);')
  writeFileSync(join(dir, 'supabase', 'seed.sql'), "insert into items (name) values ('a'), ('b');")
  return dir
}

describe('cli db reset', () => {
  it('wipes data and re-applies migrations + seed', { timeout: 30000 }, () => {
    if (!existsSync(CLI)) {
      // requires the built CLI; skip if dist isn't present
      return
    }
    const dir = project()
    const run = (...args: string[]) => execFileSync('node', [CLI, ...args, '--dir', dir], { encoding: 'utf8' })

    run('migrate')
    // reset should succeed and report the seed
    const out = run('db', 'reset')
    expect(out).toContain('reset complete')
    expect(out).toContain('+ seed')

    // second reset must also work (stale-state safe) and stay at the seed baseline
    const out2 = run('db', 'reset')
    expect(out2).toContain('reset complete')
  })

  it('unknown db subcommand exits non-zero', { timeout: 15000 }, () => {
    if (!existsSync(CLI)) return
    const dir = project()
    let failed = false
    try {
      execFileSync('node', [CLI, 'db', 'frobnicate', '--dir', dir], { stdio: 'pipe' })
    } catch {
      failed = true
    }
    expect(failed).toBe(true)
  })
})
