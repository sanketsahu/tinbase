import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackend, type TinbaseBackend } from '../src/index.js'

const MIGRATION = `
create table orders (id serial primary key, total numeric, status text);
create table audit (id serial primary key, note text);
`

interface Captured {
  url: string
  headers: Record<string, string>
  body: any
}
const received: Captured[] = []

// mock HTTP endpoint: records every webhook delivery
const webhookFetch: typeof fetch = async (input, init) => {
  received.push({
    url: input.toString(),
    headers: (init?.headers as Record<string, string>) ?? {},
    body: JSON.parse((init?.body as string) ?? '{}'),
  })
  return new Response('ok', { status: 200 })
}

let backend: TinbaseBackend
let supabase: ReturnType<typeof createClient>

const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms))

beforeAll(async () => {
  backend = await createBackend({
    migrations: [{ name: '20240101000000_wh', sql: MIGRATION }],
    webhookFetch,
    webhooks: [
      { table: 'orders', url: 'https://hooks.test/orders', headers: { authorization: 'Bearer secret' } },
      { table: 'audit', events: ['INSERT'], url: 'https://hooks.test/audit-inserts' },
    ],
  })
  supabase = createClient('http://localhost:54321', backend.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (i, init) => backend.fetch(new Request(i, init)) },
  })
})

afterAll(async () => {
  await backend.close()
})

describe('database webhooks', () => {
  it('fires on INSERT with the Supabase payload shape and custom headers', async () => {
    received.length = 0
    await supabase.from('orders').insert({ total: 42, status: 'new' })
    await wait()
    expect(received).toHaveLength(1)
    const d = received[0]
    expect(d.url).toBe('https://hooks.test/orders')
    expect(d.headers.authorization).toBe('Bearer secret')
    expect(d.body.type).toBe('INSERT')
    expect(d.body.table).toBe('orders')
    expect(d.body.schema).toBe('public')
    expect(d.body.record).toMatchObject({ total: 42, status: 'new' })
    expect(d.body.old_record).toBeNull()
  })

  it('fires on UPDATE with old_record and new record', async () => {
    const ins = await supabase.from('orders').insert({ total: 10, status: 'a' }).select().single()
    received.length = 0
    await supabase.from('orders').update({ status: 'b' }).eq('id', (ins.data as any).id)
    await wait()
    const upd = received.find((r) => r.body.type === 'UPDATE')
    expect(upd).toBeTruthy()
    expect(upd!.body.old_record.status).toBe('a')
    expect(upd!.body.record.status).toBe('b')
  })

  it('respects the events filter (audit hook only fires on INSERT)', async () => {
    const ins = await supabase.from('audit').insert({ note: 'x' }).select().single()
    received.length = 0
    await supabase.from('audit').update({ note: 'y' }).eq('id', (ins.data as any).id)
    await wait()
    // UPDATE must NOT deliver to the INSERT-only audit hook
    expect(received.filter((r) => r.url.includes('audit'))).toHaveLength(0)
  })

  it('can register a webhook at runtime', async () => {
    backend.webhooks.register({ table: 'orders', events: ['DELETE'], url: 'https://hooks.test/deletes' })
    const ins = await supabase.from('orders').insert({ total: 1 }).select().single()
    received.length = 0
    await supabase.from('orders').delete().eq('id', (ins.data as any).id)
    await wait()
    expect(received.some((r) => r.url === 'https://hooks.test/deletes' && r.body.type === 'DELETE')).toBe(true)
  })
})
