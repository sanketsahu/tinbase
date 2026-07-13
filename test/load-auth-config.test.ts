import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadAuthConfigDefaults } from '../src/node/load-auth-config.js'

function project(configToml?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tb-authcfg-'))
  if (configToml !== undefined) {
    mkdirSync(join(dir, 'supabase'), { recursive: true })
    writeFileSync(join(dir, 'supabase', 'config.toml'), configToml)
  }
  return dir
}

describe('loadAuthConfigDefaults', () => {
  it('maps [auth] keys, inverting enable_confirmations to autoconfirm', () => {
    const dir = project(`
[auth]
site_url = "http://localhost:3000"
disable_signup = true
enable_anonymous_sign_ins = false
enable_confirmations = true
minimum_password_length = 10

[auth.email]
enable_signup = true

[auth.external.google]
client_id = "x"
`)
    expect(loadAuthConfigDefaults(dir)).toEqual({
      disableSignup: true,
      anonymousUsers: false,
      autoconfirm: false, // enable_confirmations = true -> not auto-confirmed
      minPasswordLength: 10,
    })
  })

  it('only reads the [auth] table, ignoring nested sections and comments', () => {
    const dir = project(`
[auth]
disable_signup = false  # inline comment
[auth.sms]
enable_signup = true
disable_signup = true
`)
    // disable_signup from [auth.sms] must not leak into the result
    expect(loadAuthConfigDefaults(dir)).toEqual({ disableSignup: false })
  })

  it('omits keys that are absent so built-in defaults win', () => {
    const dir = project(`
[auth]
minimum_password_length = 8
`)
    expect(loadAuthConfigDefaults(dir)).toEqual({ minPasswordLength: 8 })
  })

  it('returns empty when there is no config.toml', () => {
    expect(loadAuthConfigDefaults(project())).toEqual({})
  })
})
