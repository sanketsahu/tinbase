/**
 * Runtime-mutable auth settings — the knobs Studio's "Sign In / Providers"
 * page toggles. One shared object is created at boot, read by the auth
 * handler on every request, mutated in place by the admin API, and persisted
 * to the auth.config kv table so restarts keep the operator's choices.
 */
import type { Database } from '../db/database.js'

export interface AuthSettings {
  /** When true, new email/password signups are rejected (existing users can still sign in). */
  disableSignup: boolean
  /** Allow signInAnonymously() to mint temporary users. */
  anonymousUsers: boolean
  /** Confirm email addresses automatically on signup. When false, users must verify via the emailed link before signing in. */
  autoconfirm: boolean
  /** Minimum accepted password length (signup, updateUser, admin create). */
  minPasswordLength: number
  /** Configured OAuth providers the operator has switched off at runtime. */
  disabledProviders: string[]
}

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  disableSignup: false,
  anonymousUsers: true,
  autoconfirm: true,
  minPasswordLength: 6,
  disabledProviders: [],
}

/** Clamp/typecheck a stored or patched settings object into a valid one. */
function sanitize(raw: Record<string, unknown>): AuthSettings {
  const s = { ...DEFAULT_AUTH_SETTINGS }
  if (typeof raw.disableSignup === 'boolean') s.disableSignup = raw.disableSignup
  if (typeof raw.anonymousUsers === 'boolean') s.anonymousUsers = raw.anonymousUsers
  if (typeof raw.autoconfirm === 'boolean') s.autoconfirm = raw.autoconfirm
  if (typeof raw.minPasswordLength === 'number' && Number.isFinite(raw.minPasswordLength)) {
    s.minPasswordLength = Math.max(4, Math.min(72, Math.floor(raw.minPasswordLength)))
  }
  if (Array.isArray(raw.disabledProviders)) {
    s.disabledProviders = raw.disabledProviders.filter((p): p is string => typeof p === 'string').slice(0, 50)
  }
  return s
}

/** Load persisted settings (auth.config key 'settings'), merged over defaults. */
export async function loadAuthSettings(db: Database): Promise<AuthSettings> {
  try {
    const res = await db.query(`select value from auth.config where key = 'settings'`)
    const stored = (res.rows[0] as { value: Record<string, unknown> } | undefined)?.value ?? {}
    return sanitize(stored)
  } catch {
    return { ...DEFAULT_AUTH_SETTINGS }
  }
}

/** Persist the settings object to auth.config. */
export async function saveAuthSettings(db: Database, settings: AuthSettings): Promise<void> {
  await db.query(
    `insert into auth.config (key, value, updated_at) values ('settings', $1::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [JSON.stringify(settings)]
  )
}

/**
 * Apply a partial patch onto the shared settings object IN PLACE (so every
 * holder of the reference — the auth handler — sees the change immediately).
 *
 * @returns An error message for an invalid patch, or `null` on success.
 */
export function applyAuthSettingsPatch(target: AuthSettings, patch: Record<string, unknown>): string | null {
  const KEYS = ['disableSignup', 'anonymousUsers', 'autoconfirm', 'minPasswordLength', 'disabledProviders']
  for (const k of Object.keys(patch)) {
    if (!KEYS.includes(k)) return `unknown setting: ${k}`
  }
  for (const k of ['disableSignup', 'anonymousUsers', 'autoconfirm'] as const) {
    if (k in patch && typeof patch[k] !== 'boolean') return `${k} must be a boolean`
  }
  if ('minPasswordLength' in patch) {
    const n = patch.minPasswordLength
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 4 || n > 72) {
      return 'minPasswordLength must be a number between 4 and 72'
    }
  }
  if ('disabledProviders' in patch) {
    const arr = patch.disabledProviders
    if (!Array.isArray(arr) || arr.some((p) => typeof p !== 'string')) {
      return 'disabledProviders must be an array of provider names'
    }
  }
  Object.assign(target, sanitize({ ...target, ...patch }))
  return null
}
