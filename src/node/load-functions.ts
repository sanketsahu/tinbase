/** Loads edge functions from supabase/functions/<name>/index.{ts,js,mjs} (Node only). */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { EdgeFunction } from '../functions/handler.js'
import { installDenoShim, resetCapturedHandler, takeCapturedHandler } from '../functions/deno-shim.js'
import { bundleFunction } from './bundle-function.js'

/**
 * Load edge-function secrets from supabase/functions/.env (KEY=VALUE lines,
 * `#` comments). These are exposed to functions via Deno.env and ctx.env —
 * the local equivalent of `supabase functions serve --env-file`.
 */
export async function loadFunctionEnv(projectDir: string): Promise<Record<string, string>> {
  let text: string
  try {
    text = await readFile(join(projectDir, 'supabase', 'functions', '.env'), 'utf8')
  } catch {
    return {}
  }
  const env: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (key) env[key] = val
  }
  return env
}

/** Per-function options from config.toml [functions.<name>]. */
export interface LoadFunctionOptions {
  /** Skip loading when explicitly disabled. */
  enabled?: boolean
  /** Custom entrypoint path, relative to the project root. */
  entrypoint?: string
}

export async function loadFunctions(
  projectDir: string,
  options: Record<string, LoadFunctionOptions> = {}
): Promise<Map<string, EdgeFunction>> {
  const functions = new Map<string, EdgeFunction>()
  const root = join(projectDir, 'supabase', 'functions')

  let entries: string[] = []
  try {
    entries = await readdir(root)
  } catch {
    return functions
  }

  // so Supabase-style `Deno.serve(handler)` functions run unchanged
  installDenoShim()

  for (const name of entries) {
    if (name.startsWith('_') || name.startsWith('.')) continue
    if (options[name]?.enabled === false) continue // disabled in config.toml
    const dir = join(root, name)
    if (!(await stat(dir)).isDirectory()) continue
    // A config.toml entrypoint overrides the default index.* discovery.
    const candidates = options[name]?.entrypoint
      ? [join(projectDir, options[name].entrypoint!)]
      : ['index.ts', 'index.tsx', 'index.js', 'index.mjs'].map((f) => join(dir, f))
    for (const path of candidates) {
      try {
        await stat(path)
      } catch {
        continue
      }
      try {
        // Bundle with esbuild so TS, relative imports, and npm:/jsr:/URL
        // specifiers resolve. If esbuild isn't installed, import the file
        // directly (Web-API / Deno.serve functions still work).
        let importUrl: string
        try {
          importUrl = pathToFileURL(await bundleFunction(path, name)).href
        } catch (e) {
          if ((e as Error).message !== 'esbuild-not-available') throw e
          importUrl = pathToFileURL(path).href
        }
        resetCapturedHandler()
        const mod = (await import(importUrl)) as { default?: EdgeFunction }
        // prefer an explicit default export; otherwise use the handler a
        // Deno.serve() call captured during import
        const denoHandler = takeCapturedHandler()
        const handler = typeof mod.default === 'function' ? mod.default : denoHandler ? (req: Request) => denoHandler(req) : undefined
        if (handler) {
          functions.set(name, handler as EdgeFunction)
        } else {
          console.warn(`  warning: function "${name}" has no default export or Deno.serve() handler, skipped`)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/Unknown file extension|Cannot find module/.test(msg)) {
          console.warn(`  warning: function "${name}" needs bundling — install esbuild, or run tinbase with tsx/bun`)
        } else {
          console.warn(`  warning: failed to load function "${name}": ${msg}`)
        }
      }
      break
    }
  }
  return functions
}
