import { BASE } from '../api'

/**
 * Returns the base URL of the tinbase server (same-origin in production, a
 * fixed port in dev).
 *
 * @returns The server base URL.
 */
export function apiUrl(): string {
  return BASE || window.location.origin
}

/**
 * Builds an in-process usage snippet. Every tinbase service is a
 * `(Request) ⇒ Response` fetch handler, so the whole backend can run inside
 * the page with no server.
 *
 * @returns The example source code as a string.
 */
export function inProcessSnippet(): string {
  return `import { createClient } from '@supabase/supabase-js'
import { createBackend, createPgmemEngine } from 'tinbase'

// a whole backend — in memory, inside the page
const backend = await createBackend({
  engine: await createPgmemEngine(), // pure JS — omit for PGlite (real Postgres in WASM)
})

// hand it to supabase-js as a custom fetch — no server, no network
const supabase = createClient('http://localhost', backend.anonKey, {
  global: { fetch: (input, init) => backend.fetch(new Request(input, init)) },
})

// query it like any Supabase project — swap in your table and columns
await supabase.from('YOUR_TABLE').insert({ some_column: 'value' })
const { data } = await supabase.from('YOUR_TABLE').select()`
}
