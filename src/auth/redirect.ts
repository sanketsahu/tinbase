/**
 * Redirect-URL validation, matching GoTrue's URI_ALLOW_LIST behavior: a
 * client-supplied `redirect_to` is only honored when it is same-origin with the
 * site URL or matches a configured allowlist entry. Anything else falls back to
 * the site URL, so a crafted magic-link/OAuth URL can't redirect a victim (and
 * the freshly minted session tokens) to an attacker-controlled origin.
 */

/**
 * Convert a GoTrue-style allowlist glob into a RegExp. `*` matches within a
 * path segment, `**` matches across segments — the same semantics GoTrue uses
 * for URI_ALLOW_LIST entries.
 */
function globToRegExp(pattern: string): RegExp {
  let out = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*'
        i++
      } else {
        out += '[^/]*'
      }
    } else if ('\\^$.|?+()[]{}'.includes(c)) {
      out += '\\' + c
    } else {
      out += c
    }
  }
  return new RegExp(`^${out}/?$`, 'i')
}

/**
 * Resolve the redirect target: return `requested` when it is allowed, otherwise
 * fall back to `siteUrl`. `requested` is allowed when it is same-origin with
 * `siteUrl` or matches any `allowList` glob.
 *
 * When `enforce` is false (the default for a loopback/local-dev backend), any
 * well-formed absolute URL is honored — matching how `supabase start` lets a
 * dev redirect anywhere locally. The backend sets `enforce` to true once bound
 * to a network-exposed host, at which point the allowlist is strict.
 */
export function resolveRedirect(
  requested: string | null | undefined,
  siteUrl: string,
  allowList: string[] = [],
  enforce = false
): string {
  if (!requested) return siteUrl
  if (!enforce) {
    try {
      new URL(requested)
      return requested
    } catch {
      return siteUrl
    }
  }
  if (isAllowedRedirect(requested, siteUrl, allowList)) return requested
  return siteUrl
}

/** Whether `requested` is same-origin with `siteUrl` or matches the allowlist. */
export function isAllowedRedirect(requested: string, siteUrl: string, allowList: string[] = []): boolean {
  let target: URL
  try {
    target = new URL(requested)
  } catch {
    return false
  }
  try {
    if (target.origin === new URL(siteUrl).origin) return true
  } catch {
    // siteUrl misconfigured — fall through to the explicit allowlist only.
  }
  return allowList.some((entry) => globToRegExp(entry).test(requested))
}
