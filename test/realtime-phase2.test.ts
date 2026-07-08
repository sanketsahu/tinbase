import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve, type RunningServer } from '../src/node/server.js'
import { createBackend, type TinbaseBackend } from '../src/index.js'

/**
 * Phase 2 realtime: broadcast-from-database (realtime.send) and private-channel
 * authorization via RLS on realtime.messages. The policies below grant
 * authenticated users read+write on topic "room"; anon gets nothing.
 */
const MIGRATION = `
create policy rt_read on realtime.messages for select to authenticated
  using (realtime.topic() = 'room');
create policy rt_write on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'room');
`

let backend: TinbaseBackend
let server: RunningServer
const opened: RealtimeChannel[] = []
const clients: SupabaseClient[] = []

function mkClient(): SupabaseClient {
  const c = createClient(server.url, backend.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  clients.push(c)
  return c
}

/** Subscribe and resolve with the terminal channel status. */
function waitStatus(ch: RealtimeChannel): Promise<string> {
  opened.push(ch)
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve('TIMED_OUT'), 6000)
    ch.subscribe((s) => {
      if (['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(s)) {
        clearTimeout(t)
        resolve(s)
      }
    })
  })
}

function waitFor<T>(setup: (resolve: (v: T) => void) => void, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('event timeout')), ms)
    setup((v) => {
      clearTimeout(t)
      resolve(v)
    })
  })
}

beforeAll(async () => {
  backend = await createBackend({ migrations: [{ name: '20240101000000_rt2', sql: MIGRATION }] })
  server = await serve(backend, { port: 0 })
})

afterAll(async () => {
  for (const ch of opened) await ch.unsubscribe().catch(() => {})
  for (const c of clients) c.realtime.disconnect()
  await server.close()
  await backend.close()
})

describe('realtime phase 2', () => {
  it('delivers a broadcast sent from the database (realtime.send)', async () => {
    const c = mkClient()
    const ch = c.channel('news')
    const got = waitFor<any>((resolve) => ch.on('broadcast', { event: 'ping' }, (m) => resolve(m)))
    expect(await waitStatus(ch)).toBe('SUBSCRIBED')

    await backend.db.query(`select realtime.send('{"hi":"from-db"}'::jsonb, 'ping', 'news', false)`)
    const msg = await got
    expect(msg.event).toBe('ping')
    expect(msg.payload.hi).toBe('from-db')
  })

  it('authorizes an authenticated user on a private channel', async () => {
    const c = mkClient()
    const { error } = await c.auth.signUp({ email: `rt-${Date.now()}@example.com`, password: 'password123' })
    expect(error).toBeNull()
    const ch = c.channel('room', { config: { private: true } })
    expect(await waitStatus(ch)).toBe('SUBSCRIBED')
  })

  it('delivers a db broadcast to the authorized private subscriber', async () => {
    const c = mkClient()
    await c.auth.signUp({ email: `rt2-${Date.now()}@example.com`, password: 'password123' })
    const ch = c.channel('room', { config: { private: true } })
    const got = waitFor<any>((resolve) => ch.on('broadcast', { event: 'evt' }, (m) => resolve(m)))
    expect(await waitStatus(ch)).toBe('SUBSCRIBED')

    await backend.db.query(`select realtime.send('{"secret":42}'::jsonb, 'evt', 'room', true)`)
    const msg = await got
    expect(msg.payload.secret).toBe(42)
  })

  it('rejects an unauthorized (anon) user on a private channel', async () => {
    const c = mkClient() // no sign-in → anon token
    const ch = c.channel('room', { config: { private: true } })
    expect(await waitStatus(ch)).toBe('CHANNEL_ERROR')
  })
})
