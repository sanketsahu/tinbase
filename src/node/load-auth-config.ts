/**
 * Read the auth defaults an existing Supabase project already declares in
 * supabase/config.toml's [auth] section, so no new config is needed and the
 * settings stay version-controlled and portable to hosted Supabase.
 *
 * These become the DEFAULTS at boot. The runtime auth.config table (edited live
 * from the studio) is layered on top by loadAuthSettings, so config.toml is the
 * committed baseline and live toggles are per-instance overrides.
 *
 * Mapped keys (config.toml -> tinbase AuthSettings):
 *   disable_signup             -> disableSignup
 *   enable_anonymous_sign_ins  -> anonymousUsers
 *   enable_confirmations       -> autoconfirm (inverted: confirmations on = not auto-confirmed)
 *   minimum_password_length    -> minPasswordLength
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthSettings } from '../auth/settings.js'

/** Parse [auth] from config.toml into a partial AuthSettings; empty if absent/unreadable. */
export function loadAuthConfigDefaults(projectDir: string): Partial<AuthSettings> {
  let text: string
  try {
    text = readFileSync(join(projectDir, 'supabase', 'config.toml'), 'utf8')
  } catch {
    return {}
  }

  // Collect key = value pairs from the [auth] table only (stop at the next
  // section, e.g. [auth.email] or [auth.external.google], which we don't map).
  const kv = new Map<string, string>()
  let inAuth = false
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/#.*$/, '').trim()
    if (!trimmed) continue
    const section = trimmed.match(/^\[([^\]]+)\]$/)
    if (section) {
      inAuth = section[1].trim() === 'auth'
      continue
    }
    if (!inAuth) continue
    const m = trimmed.match(/^([a-z_]+)\s*=\s*(.+)$/i)
    if (m) kv.set(m[1], m[2].trim().replace(/^["']|["']$/g, ''))
  }

  const out: Partial<AuthSettings> = {}
  const bool = (v: string | undefined): boolean | undefined =>
    v === undefined ? undefined : v === 'true' ? true : v === 'false' ? false : undefined

  const disableSignup = bool(kv.get('disable_signup'))
  if (disableSignup !== undefined) out.disableSignup = disableSignup

  const anon = bool(kv.get('enable_anonymous_sign_ins'))
  if (anon !== undefined) out.anonymousUsers = anon

  // Supabase's enable_confirmations = require email confirmation, which is the
  // inverse of our autoconfirm.
  const confirmations = bool(kv.get('enable_confirmations'))
  if (confirmations !== undefined) out.autoconfirm = !confirmations

  const minLen = kv.get('minimum_password_length')
  if (minLen !== undefined) {
    const n = parseInt(minLen, 10)
    if (Number.isFinite(n)) out.minPasswordLength = n
  }

  return out
}
