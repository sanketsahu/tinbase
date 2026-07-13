import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProjectConfig } from '../src/node/load-config.js'

function project(configToml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-config-'))
  if (configToml !== undefined) {
    mkdirSync(join(dir, 'supabase'), { recursive: true })
    writeFileSync(join(dir, 'supabase', 'config.toml'), configToml)
  }
  return dir
}

describe('loadProjectConfig — [auth] settings', () => {
  it('maps [auth] + [auth.email] + [auth.mfa] settings', () => {
    const dir = project(`
[auth]
disable_signup = false
enable_anonymous_sign_ins = false
minimum_password_length = 10

[auth.email]
enable_confirmations = true
otp_length = 8
otp_expiry = 900

[auth.mfa]
max_enrolled_factors = 3

[auth.mfa.totp]
enroll_enabled = false
verify_enabled = true
`)
    expect(loadProjectConfig(dir).auth.settings).toEqual({
      disableSignup: false,
      anonymousUsers: false,
      autoconfirm: false, // enable_confirmations = true -> not auto-confirmed
      minPasswordLength: 10,
      otpLength: 8,
      otpExpirySeconds: 900,
      maxEnrolledFactors: 3,
      totpEnrollEnabled: false,
      totpVerifyEnabled: true,
    })
  })

  it('enable_signup at [auth.email] disables signups too', () => {
    const dir = project(`\n[auth.email]\nenable_signup = false\n`)
    expect(loadProjectConfig(dir).auth.settings.disableSignup).toBe(true)
  })

  it('only reads the top-level [auth] table for legacy keys', () => {
    const dir = project(`
[auth]
disable_signup = false
[auth.sms]
disable_signup = true
`)
    expect(loadProjectConfig(dir).auth.settings.disableSignup).toBe(false)
  })
})

describe('loadProjectConfig — [auth] backend keys', () => {
  it('reads site_url, jwt_expiry, additional_redirect_urls, sessions, enabled', () => {
    const dir = project(`
[auth]
enabled = true
site_url = "http://localhost:3000"
jwt_expiry = 7200
additional_redirect_urls = ["http://localhost:3000/**", "https://app.example.com/cb"]

[auth.sessions]
timebox = "24h"
inactivity_timeout = "30m"
`)
    const auth = loadProjectConfig(dir).auth
    expect(auth.enabled).toBe(true)
    expect(auth.siteUrl).toBe('http://localhost:3000')
    expect(auth.jwtExpiry).toBe(7200)
    expect(auth.uriAllowList).toEqual(['http://localhost:3000/**', 'https://app.example.com/cb'])
    expect(auth.sessionTimeboxSeconds).toBe(24 * 3600)
    expect(auth.sessionInactivitySeconds).toBe(30 * 60)
  })

  it('maps [auth.rate_limit] to limiter rules', () => {
    const dir = project(`
[auth.rate_limit]
sign_in_sign_ups = 12
token_verifications = 8
email_sent = 4
`)
    const rl = loadProjectConfig(dir).auth.rateLimits!
    expect(rl.token).toEqual({ limit: 12, windowMs: 5 * 60 * 1000 })
    expect(rl.signup).toEqual({ limit: 12, windowMs: 5 * 60 * 1000 })
    expect(rl.verify).toEqual({ limit: 8, windowMs: 5 * 60 * 1000 })
    expect(rl.otp).toEqual({ limit: 4, windowMs: 60 * 60 * 1000 })
    expect(rl.recover).toEqual({ limit: 4, windowMs: 60 * 60 * 1000 })
  })
})

describe('loadProjectConfig — [api] / [storage] / [db.seed] / [functions]', () => {
  it('reads [api].schemas and max_rows', () => {
    const dir = project(`\n[api]\nschemas = ["public", "store"]\nmax_rows = 500\n`)
    expect(loadProjectConfig(dir).api).toEqual({ schemas: ['public', 'store'], maxRows: 500 })
  })

  it('reads [storage].file_size_limit and [storage.buckets.*]', () => {
    const dir = project(`
[storage]
file_size_limit = "50MiB"

[storage.buckets.avatars]
public = true
file_size_limit = "5MB"
allowed_mime_types = ["image/png", "image/jpeg"]

[storage.buckets.docs]
`)
    const s = loadProjectConfig(dir).storage
    expect(s.fileSizeLimit).toBe(50 * 1024 * 1024)
    expect(s.buckets).toEqual([
      { id: 'avatars', public: true, fileSizeLimit: 5 * 1000 * 1000, allowedMimeTypes: ['image/png', 'image/jpeg'] },
      { id: 'docs', public: false, fileSizeLimit: null, allowedMimeTypes: null },
    ])
  })

  it('reads [db.seed] enabled + sql_paths', () => {
    const dir = project(`\n[db.seed]\nenabled = false\nsql_paths = ["seed.sql", "extra.sql"]\n`)
    expect(loadProjectConfig(dir).seed).toEqual({ enabled: false, paths: ['seed.sql', 'extra.sql'] })
  })

  it('reads per-function [functions.<name>] options', () => {
    const dir = project(`
[functions.hello]
enabled = true
verify_jwt = false

[functions.secret]
enabled = false
entrypoint = "supabase/functions/secret/main.ts"
`)
    expect(loadProjectConfig(dir).functions).toEqual({
      hello: { enabled: true, verifyJwt: false },
      secret: { enabled: false, entrypoint: 'supabase/functions/secret/main.ts' },
    })
  })

  it('returns empty sections when there is no config.toml', () => {
    const cfg = loadProjectConfig(project())
    expect(cfg.auth.settings).toEqual({})
    expect(cfg.api).toEqual({})
    expect(cfg.storage).toEqual({})
    expect(cfg.seed).toEqual({})
    expect(cfg.functions).toEqual({})
  })
})

describe('loadProjectConfig — OAuth providers ([auth.external.*] + env)', () => {
  const providers = (dir: string, env: Record<string, string> = {}) =>
    loadProjectConfig(dir, env).auth.oauthProviders

  it('reads [auth.external.*] and resolves env()', () => {
    const dir = project(`
[auth.external.google]
enabled = true
client_id = "google-id"
secret = "env(MY_GOOGLE_SECRET)"

[auth.external.github]
enabled = false
client_id = "gh-id"
secret = "gh-secret"
`)
    const p = providers(dir, { MY_GOOGLE_SECRET: 'resolved-secret' })
    expect(p.google.clientId).toBe('google-id')
    expect(p.google.clientSecret).toBe('resolved-secret')
    expect(p.github).toBeUndefined() // enabled = false -> skipped
  })

  it('falls back to GOTRUE_EXTERNAL_ env vars', () => {
    const p = providers(project(), {
      GOTRUE_EXTERNAL_GITHUB_CLIENT_ID: 'x',
      GOTRUE_EXTERNAL_GITHUB_SECRET: 'y',
      GOTRUE_EXTERNAL_GITHUB_ENABLED: 'true',
    })
    expect(p.github).toEqual(expect.objectContaining({ clientId: 'x', clientSecret: 'y' }))
  })

  it('config.toml wins over env for the same provider', () => {
    const dir = project(`
[auth.external.google]
enabled = true
client_id = "from-toml"
secret = "toml-secret"
`)
    const p = providers(dir, {
      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: 'from-env',
      GOTRUE_EXTERNAL_GOOGLE_SECRET: 'env-secret',
    })
    expect(p.google.clientId).toBe('from-toml')
  })

  it('TINBASE_OAUTH_ alias still works', () => {
    const p = providers(project(), {
      TINBASE_OAUTH_GOOGLE_CLIENT_ID: 'a',
      TINBASE_OAUTH_GOOGLE_CLIENT_SECRET: 'b',
    })
    expect(p.google?.clientId).toBe('a')
  })
})
