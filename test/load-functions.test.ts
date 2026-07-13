import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFunctions } from '../src/node/load-functions.js'

/** Scaffold a project with the given `functions/<name>/<file>` = source entries. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-fns-'))
  for (const [rel, src] of Object.entries(files)) {
    const full = join(dir, 'supabase', 'functions', rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, src)
  }
  return dir
}

// A trivial handler that both default-exports and works without esbuild/Deno.
const HELLO = `export default () => new Response("hi")`

describe('loadFunctions — config.toml [functions.<name>] options', () => {
  it('loads a discovered function by default', async () => {
    const dir = project({ 'hello/index.ts': HELLO })
    const fns = await loadFunctions(dir)
    expect(fns.has('hello')).toBe(true)
  })

  it('skips a function disabled in config.toml', async () => {
    const dir = project({ 'hello/index.ts': HELLO, 'off/index.ts': HELLO })
    const fns = await loadFunctions(dir, { off: { enabled: false } })
    expect(fns.has('hello')).toBe(true)
    expect(fns.has('off')).toBe(false)
  })

  it('honors a custom entrypoint', async () => {
    const dir = project({ 'custom/main.ts': HELLO })
    // no index.* — only main.ts, reachable only via the configured entrypoint
    const withoutCfg = await loadFunctions(dir)
    expect(withoutCfg.has('custom')).toBe(false)
    const withCfg = await loadFunctions(dir, {
      custom: { entrypoint: 'supabase/functions/custom/main.ts' },
    })
    expect(withCfg.has('custom')).toBe(true)
  })
})
