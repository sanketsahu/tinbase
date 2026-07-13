/**
 * Startup guards for the "not local anymore" transition. Tinbase ships with the
 * well-known Supabase local-dev defaults so `tinbase start` just works on
 * localhost; the moment the server is bound to a non-loopback interface those
 * same defaults become forgeable, so we escalate the relevant warnings into
 * hard errors.
 */
import { DEFAULT_JWT_SECRET } from './types.js'

/** Loopback hosts that keep tinbase in local-dev mode (defaults allowed). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '', undefined])

/**
 * Whether `host` exposes the server beyond loopback. Wildcard binds
 * (`0.0.0.0`, `::`) and any concrete non-loopback address count as exposed.
 */
export function isNetworkExposed(host: string | undefined): boolean {
  return !LOOPBACK_HOSTS.has(host)
}

export interface SecretGuardInput {
  host?: string
  jwtSecret: string
  /** Whether the vault key was derived from the JWT secret rather than set explicitly. */
  vaultKeyDerived: boolean
  warn: (msg: string) => void
}

/**
 * Enforce secret hygiene at boot. On a loopback bind, weak defaults only warn;
 * on a network-exposed bind they throw, refusing to start with forgeable
 * credentials. Returns nothing; throws {@link Error} to abort startup.
 */
export function assertSecretsSafe(input: SecretGuardInput): void {
  const { host, jwtSecret, vaultKeyDerived, warn } = input
  const exposed = isNetworkExposed(host)
  const usingDefaultSecret = jwtSecret === DEFAULT_JWT_SECRET
  const weakSecret = jwtSecret.length < 32

  if (usingDefaultSecret || weakSecret) {
    const reason = usingDefaultSecret
      ? 'the JWT secret is the public Supabase local-dev default'
      : 'the JWT secret is shorter than 32 characters'
    if (exposed) {
      throw new Error(
        `Refusing to start: ${reason} while bound to a network-exposed host (${host}). ` +
          `Anyone reaching this port could forge a service_role token. ` +
          `Set a strong secret via --jwt-secret or the TINBASE_JWT_SECRET env var.`
      )
    }
    warn(`⚠ ${reason} — fine for local dev, but set --jwt-secret before exposing this server.`)
  }

  if (vaultKeyDerived && (usingDefaultSecret || weakSecret)) {
    if (exposed) {
      throw new Error(
        'Refusing to start: the Vault encryption key is derived from a weak/default JWT secret ' +
          'while network-exposed. Set an independent vaultKey (createBackend) so at-rest encryption is real.'
      )
    }
    warn('⚠ Vault key derived from the JWT secret — set an independent vaultKey before exposing this server.')
  }
}
