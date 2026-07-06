import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBackend, type TinbaseBackend, type MailMessage } from '../src/index.js'

let backend: TinbaseBackend
let supabase: ReturnType<typeof createClient>
const outbox: MailMessage[] = []

const lastCode = () => outbox[outbox.length - 1].text.match(/code is (\d{6})|use code (\d{6})/)?.slice(1).find(Boolean)
const lastLink = () => outbox[outbox.length - 1].text.match(/(http\S+verify\S+)/)?.[1]

beforeAll(async () => {
  backend = await createBackend({ mailer: { send: async (m) => void outbox.push(m) } })
  supabase = createClient('http://localhost:54321', backend.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (i, init) => backend.fetch(new Request(i, init)) },
  })
})

afterAll(async () => {
  await backend.close()
})

describe('otp / magic links / recovery', () => {
  it('signInWithOtp mails a code and verifyOtp returns a session', async () => {
    const { error } = await supabase.auth.signInWithOtp({ email: 'otp@example.com' })
    expect(error).toBeNull()
    expect(outbox.length).toBeGreaterThan(0)
    const code = lastCode()!
    expect(code).toMatch(/^\d{6}$/)

    const verified = await supabase.auth.verifyOtp({ email: 'otp@example.com', token: code, type: 'email' })
    expect(verified.error).toBeNull()
    expect(verified.data.session?.access_token).toBeTruthy()
    expect(verified.data.user?.email).toBe('otp@example.com')
    await supabase.auth.signOut()
  })

  it('expired/invalid codes are rejected', async () => {
    await supabase.auth.signInWithOtp({ email: 'otp2@example.com' })
    const bad = await supabase.auth.verifyOtp({ email: 'otp2@example.com', token: '000000', type: 'email' })
    expect(bad.error).not.toBeNull()
  })

  it('magic link redeems via GET and redirects with tokens in the hash', async () => {
    await supabase.auth.signInWithOtp({ email: 'link@example.com' })
    const link = lastLink()!
    const res = await backend.fetch(new Request(`${link}&redirect_to=http://app.local/welcome`, { redirect: 'manual' }))
    expect(res.status).toBe(303)
    const location = res.headers.get('location')!
    expect(location).toContain('http://app.local/welcome#access_token=')
    expect(location).toContain('refresh_token=')
  })

  it('password recovery flow resets the password', async () => {
    await supabase.auth.signUp({ email: 'reset@example.com', password: 'oldpassword1' })
    await supabase.auth.signOut()

    const { error } = await supabase.auth.resetPasswordForEmail('reset@example.com')
    expect(error).toBeNull()
    const code = lastCode()!

    const verified = await supabase.auth.verifyOtp({ email: 'reset@example.com', token: code, type: 'recovery' })
    expect(verified.error).toBeNull()

    const upd = await supabase.auth.updateUser({ password: 'newpassword2' })
    expect(upd.error).toBeNull()
    await supabase.auth.signOut()

    const relogin = await supabase.auth.signInWithPassword({ email: 'reset@example.com', password: 'newpassword2' })
    expect(relogin.error).toBeNull()
    await supabase.auth.signOut()
  })

  it('recovery for unknown email does not create a user', async () => {
    const { error } = await supabase.auth.resetPasswordForEmail('ghost@example.com')
    expect(error).not.toBeNull()
  })
})
