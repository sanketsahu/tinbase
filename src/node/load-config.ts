/**
 * Read everything tinbase can honor from an existing Supabase project's
 * supabase/config.toml, so pointing tinbase at that project needs no new config.
 *
 * config.toml is one document, so this is one loader: parse once, then project
 * the tree into a nested `ProjectConfig` that mirrors the file's sections. The
 * CLI spreads those sections into createBackend. Sections for services tinbase
 * doesn't run (SMS, analytics, pooler, studio/edge-runtime ports, experimental)
 * are intentionally ignored.
 */
import type { AuthSettings } from '../auth/settings.js'
import type { OAuthProviderConfig } from '../auth/oauth.js'
import type { RateLimitRule } from '../auth/rate-limit.js'
import type { BucketSeed } from '../types.js'
import {
  loadConfigToml,
  tableAt,
  getBool,
  getInt,
  getString,
  getStringArray,
  getByteSize,
  getDurationSeconds,
  type ConfigTable,
} from './config-toml.js'

/** The project's config.toml, projected into the shapes tinbase consumes. */
export interface ProjectConfig {
  auth: AuthConfig
  api: ApiConfig
  storage: StorageConfig
  seed: SeedConfig
  /** Per-function options keyed by function name ([functions.<name>]). */
  functions: Record<string, FunctionOptions>
}

export interface AuthConfig {
  /** Whether to run the auth service ([auth].enabled). */
  enabled?: boolean
  /** Runtime-toggleable settings, layered under the live auth.config table. */
  settings: Partial<AuthSettings>
  /** [auth].site_url. */
  siteUrl?: string
  /** [auth].jwt_expiry, seconds. */
  jwtExpiry?: number
  /** [auth].additional_redirect_urls. */
  uriAllowList?: string[]
  /** [auth.rate_limit].* mapped to the auth limiter's rules. */
  rateLimits?: Record<string, RateLimitRule>
  /** [auth.sessions].timebox, seconds. */
  sessionTimeboxSeconds?: number
  /** [auth.sessions].inactivity_timeout, seconds. */
  sessionInactivitySeconds?: number
  /** OAuth providers from [auth.external.*] and env-var fallbacks. */
  oauthProviders: Record<string, OAuthProviderConfig>
}

export interface ApiConfig {
  /** [api].schemas -> exposed schemas (db-schemas). */
  schemas?: string[]
  /** [api].max_rows -> REST row cap. */
  maxRows?: number
}

export interface StorageConfig {
  /** [storage].file_size_limit -> default per-bucket byte limit. */
  fileSizeLimit?: number
  /** [storage.buckets.*] -> buckets to create at boot. */
  buckets?: BucketSeed[]
}

export interface SeedConfig {
  /** [db.seed].enabled. */
  enabled?: boolean
  /** [db.seed].sql_paths (files or globs, relative to supabase/). */
  paths?: string[]
}

export interface FunctionOptions {
  enabled?: boolean
  verifyJwt?: boolean
  entrypoint?: string
}

export function loadProjectConfig(projectDir: string, env: NodeJS.ProcessEnv = process.env): ProjectConfig {
  const root = loadConfigToml(projectDir, env)
  return {
    auth: readAuth(root, env),
    api: readApi(root),
    storage: readStorage(root),
    seed: readSeed(root),
    functions: readFunctions(root),
  }
}

// ── [auth] ─────────────────────────────────────────────────────────────────

function readAuth(root: ConfigTable, env: NodeJS.ProcessEnv): AuthConfig {
  const auth = tableAt(root, 'auth')
  const out: AuthConfig = { settings: readAuthSettings(root), oauthProviders: readOAuthProviders(root, env) }

  const enabled = getBool(auth, 'enabled')
  if (enabled !== undefined) out.enabled = enabled
  const siteUrl = getString(auth, 'site_url')
  if (siteUrl !== undefined) out.siteUrl = siteUrl
  const jwtExpiry = getInt(auth, 'jwt_expiry')
  if (jwtExpiry !== undefined && jwtExpiry > 0) out.jwtExpiry = jwtExpiry
  const redirects = getStringArray(auth, 'additional_redirect_urls')
  if (redirects !== undefined) out.uriAllowList = redirects

  const rateLimits = readRateLimits(root)
  if (rateLimits) out.rateLimits = rateLimits

  const sessions = tableAt(root, 'auth.sessions')
  const timebox = getDurationSeconds(sessions, 'timebox')
  if (timebox !== undefined) out.sessionTimeboxSeconds = timebox
  const inactivity = getDurationSeconds(sessions, 'inactivity_timeout')
  if (inactivity !== undefined) out.sessionInactivitySeconds = inactivity

  return out
}

/** The [auth]/[auth.email]/[auth.mfa] keys that become AuthSettings defaults. */
function readAuthSettings(root: ConfigTable): Partial<AuthSettings> {
  const auth = tableAt(root, 'auth')
  const email = tableAt(root, 'auth.email')
  const mfa = tableAt(root, 'auth.mfa')
  const mfaTotp = tableAt(root, 'auth.mfa.totp')
  const out: Partial<AuthSettings> = {}

  // Signups: [auth].disable_signup (legacy) or enable_signup at [auth]/[auth.email].
  const disableSignup = getBool(auth, 'disable_signup')
  if (disableSignup !== undefined) out.disableSignup = disableSignup
  const enableSignup = getBool(auth, 'enable_signup') ?? getBool(email, 'enable_signup')
  if (enableSignup !== undefined) out.disableSignup = !enableSignup

  const anon = getBool(auth, 'enable_anonymous_sign_ins')
  if (anon !== undefined) out.anonymousUsers = anon

  // enable_confirmations (require email confirmation) is the inverse of autoconfirm;
  // [auth.email] is canonical, top-level [auth] is the legacy alias.
  const confirmations = getBool(email, 'enable_confirmations') ?? getBool(auth, 'enable_confirmations')
  if (confirmations !== undefined) out.autoconfirm = !confirmations

  const minLen = getInt(auth, 'minimum_password_length')
  if (minLen !== undefined) out.minPasswordLength = minLen

  const otpLength = getInt(email, 'otp_length')
  if (otpLength !== undefined) out.otpLength = otpLength
  const otpExpiry = getInt(email, 'otp_expiry')
  if (otpExpiry !== undefined) out.otpExpirySeconds = otpExpiry

  const maxFactors = getInt(mfa, 'max_enrolled_factors')
  if (maxFactors !== undefined) out.maxEnrolledFactors = maxFactors
  const totpEnroll = getBool(mfaTotp, 'enroll_enabled')
  if (totpEnroll !== undefined) out.totpEnrollEnabled = totpEnroll
  const totpVerify = getBool(mfaTotp, 'verify_enabled')
  if (totpVerify !== undefined) out.totpVerifyEnabled = totpVerify

  return out
}

/** Map [auth.rate_limit].* to the auth limiter's rules (GoTrue's windows). */
function readRateLimits(root: ConfigTable): Record<string, RateLimitRule> | undefined {
  const rl = tableAt(root, 'auth.rate_limit')
  if (!rl) return undefined
  const out: Record<string, RateLimitRule> = {}
  const FIVE_MIN = 5 * 60 * 1000
  const ONE_HOUR = 60 * 60 * 1000

  const signIn = getInt(rl, 'sign_in_sign_ups')
  if (signIn !== undefined) {
    out.token = { limit: signIn, windowMs: FIVE_MIN }
    out.signup = { limit: signIn, windowMs: FIVE_MIN }
  }
  const verify = getInt(rl, 'token_verifications')
  if (verify !== undefined) out.verify = { limit: verify, windowMs: FIVE_MIN }
  const email = getInt(rl, 'email_sent')
  if (email !== undefined) {
    out.otp = { limit: email, windowMs: ONE_HOUR }
    out.recover = { limit: email, windowMs: ONE_HOUR }
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * OAuth providers, highest precedence first:
 *   1. config.toml [auth.external.<provider>]
 *   2. GOTRUE_EXTERNAL_<PROVIDER>_CLIENT_ID / _SECRET / _ENABLED
 *   3. TINBASE_OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET / _ENABLED
 * Endpoints come from presets in oauth.ts; only real overrides are passed.
 */
function readOAuthProviders(root: ConfigTable, env: NodeJS.ProcessEnv): Record<string, OAuthProviderConfig> {
  const out: Record<string, OAuthProviderConfig> = {}

  const external = tableAt(root, 'auth.external')
  if (external) {
    for (const [name, t] of external.children) {
      const enabled = getBool(t, 'enabled') ?? true
      const clientId = getString(t, 'client_id')
      const secret = getString(t, 'secret')
      if (!enabled || !clientId || !secret) continue
      const url = getString(t, 'url')
      out[name.toLowerCase()] = {
        clientId,
        clientSecret: secret,
        authorizeUrl: getString(t, 'authorize_url') ?? (url ? `${url}/authorize` : undefined),
        tokenUrl: getString(t, 'token_url') ?? (url ? `${url}/token` : undefined),
        userInfoUrl: getString(t, 'userinfo_url') ?? (url ? `${url}/userinfo` : undefined),
        scopes: getString(t, 'scopes'),
      }
    }
  }

  collectEnvProviders(env, out, 'GOTRUE_EXTERNAL_', 'SECRET')
  collectEnvProviders(env, out, 'TINBASE_OAUTH_', 'CLIENT_SECRET')
  return out
}

/** Collect providers declared via `<prefix><NAME>_CLIENT_ID/_<secretKey>/_ENABLED` env vars. */
function collectEnvProviders(
  env: NodeJS.ProcessEnv,
  out: Record<string, OAuthProviderConfig>,
  prefix: string,
  secretKey: string
): void {
  const names = new Set<string>()
  for (const key of Object.keys(env)) {
    if (key.startsWith(prefix) && key.endsWith('_CLIENT_ID')) {
      names.add(key.slice(prefix.length, -'_CLIENT_ID'.length))
    }
  }
  for (const upper of names) {
    const name = upper.toLowerCase()
    if (out[name]) continue // higher-precedence source already set it
    const g = (s: string) => env[`${prefix}${upper}_${s}`]
    const clientId = g('CLIENT_ID')
    const clientSecret = g(secretKey)
    if (!clientId || !clientSecret) continue
    if (g('ENABLED') !== undefined && g('ENABLED') !== 'true') continue
    out[name] = {
      clientId,
      clientSecret,
      authorizeUrl: g('AUTHORIZE_URL'),
      tokenUrl: g('TOKEN_URL'),
      userInfoUrl: g('USERINFO_URL'),
      scopes: g('SCOPES'),
    }
  }
}

// ── [api] ────────────────────────────────────────────────────────────────

function readApi(root: ConfigTable): ApiConfig {
  const api = tableAt(root, 'api')
  const out: ApiConfig = {}
  const schemas = getStringArray(api, 'schemas')
  if (schemas !== undefined) out.schemas = schemas
  const maxRows = getInt(api, 'max_rows')
  if (maxRows !== undefined && maxRows > 0) out.maxRows = maxRows
  return out
}

// ── [storage] ──────────────────────────────────────────────────────────────

function readStorage(root: ConfigTable): StorageConfig {
  const storage = tableAt(root, 'storage')
  const out: StorageConfig = {}
  const limit = getByteSize(storage, 'file_size_limit')
  if (limit !== undefined) out.fileSizeLimit = limit

  const buckets = tableAt(root, 'storage.buckets')
  if (buckets && buckets.children.size > 0) {
    out.buckets = [...buckets.children].map(([id, t]) => ({
      id,
      public: getBool(t, 'public') ?? false,
      fileSizeLimit: getByteSize(t, 'file_size_limit') ?? null,
      allowedMimeTypes: getStringArray(t, 'allowed_mime_types') ?? null,
    }))
  }
  return out
}

// ── [db.seed] ──────────────────────────────────────────────────────────────

function readSeed(root: ConfigTable): SeedConfig {
  const seed = tableAt(root, 'db.seed')
  const out: SeedConfig = {}
  const enabled = getBool(seed, 'enabled')
  if (enabled !== undefined) out.enabled = enabled
  const paths = getStringArray(seed, 'sql_paths')
  if (paths !== undefined) out.paths = paths
  return out
}

// ── [functions.<name>] ───────────────────────────────────────────────────

function readFunctions(root: ConfigTable): Record<string, FunctionOptions> {
  const fns = tableAt(root, 'functions')
  const out: Record<string, FunctionOptions> = {}
  if (!fns) return out
  for (const [name, t] of fns.children) {
    const opts: FunctionOptions = {}
    const enabled = getBool(t, 'enabled')
    if (enabled !== undefined) opts.enabled = enabled
    const verifyJwt = getBool(t, 'verify_jwt')
    if (verifyJwt !== undefined) opts.verifyJwt = verifyJwt
    const entrypoint = getString(t, 'entrypoint')
    if (entrypoint !== undefined) opts.entrypoint = entrypoint
    out[name] = opts
  }
  return out
}
