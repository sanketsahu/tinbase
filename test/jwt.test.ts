import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt } from '../src/jwt.js'

const SECRET = 'test-secret-at-least-32-characters-long!!'

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

describe('jwt', () => {
  it('signs and verifies a valid HS256 token', async () => {
    const token = await signJwt({ sub: 'u1', role: 'authenticated' }, SECRET)
    const claims = await verifyJwt(token, SECRET)
    expect(claims?.sub).toBe('u1')
  })

  it('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'u1', exp: 1 }, SECRET)
    expect(await verifyJwt(token, SECRET)).toBeNull()
  })

  it('rejects a bad signature', async () => {
    const token = await signJwt({ sub: 'u1' }, SECRET)
    expect(await verifyJwt(token, 'a-different-secret-that-is-also-32-chars')).toBeNull()
  })

  it('rejects an alg:none token (header alg is pinned to HS256)', async () => {
    // an attacker crafts a token with alg:none and no/empty signature
    const forged = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ sub: 'admin', role: 'service_role' })}.`
    expect(await verifyJwt(forged, SECRET)).toBeNull()
  })

  it('rejects a token whose header claims a non-HS256 alg', async () => {
    const valid = await signJwt({ sub: 'u1' }, SECRET)
    const [, payload, sig] = valid.split('.')
    const swapped = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${payload}.${sig}`
    expect(await verifyJwt(swapped, SECRET)).toBeNull()
  })
})
