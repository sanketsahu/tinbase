import { describe, expect, it } from 'vitest'
import { DEFAULT_AUTH_SETTINGS, applyAuthSettingsPatch, type AuthSettings } from '../src/auth/settings.js'

/** A fresh, mutable copy of the defaults for each patch test. */
function fresh(): AuthSettings {
  return { ...DEFAULT_AUTH_SETTINGS, disabledProviders: [] }
}

describe('applyAuthSettingsPatch', () => {
  it('patches the classic five settings', () => {
    const s = fresh()
    expect(
      applyAuthSettingsPatch(s, {
        disableSignup: true,
        anonymousUsers: false,
        autoconfirm: false,
        minPasswordLength: 12,
        disabledProviders: ['github'],
      })
    ).toBeNull()
    expect(s.disableSignup).toBe(true)
    expect(s.anonymousUsers).toBe(false)
    expect(s.autoconfirm).toBe(false)
    expect(s.minPasswordLength).toBe(12)
    expect(s.disabledProviders).toEqual(['github'])
  })

  it('patches the newer OTP / MFA settings (previously rejected as unknown)', () => {
    const s = fresh()
    expect(
      applyAuthSettingsPatch(s, {
        otpLength: 8,
        otpExpirySeconds: 900,
        maxEnrolledFactors: 3,
        totpEnrollEnabled: false,
        totpVerifyEnabled: false,
      })
    ).toBeNull()
    expect(s.otpLength).toBe(8)
    expect(s.otpExpirySeconds).toBe(900)
    expect(s.maxEnrolledFactors).toBe(3)
    expect(s.totpEnrollEnabled).toBe(false)
    expect(s.totpVerifyEnabled).toBe(false)
  })

  it('rejects an unknown key', () => {
    expect(applyAuthSettingsPatch(fresh(), { bogus: true })).toMatch(/unknown setting: bogus/)
  })

  it('validates types and bounds mirroring sanitize()', () => {
    expect(applyAuthSettingsPatch(fresh(), { totpEnrollEnabled: 'yes' })).toMatch(/must be a boolean/)
    expect(applyAuthSettingsPatch(fresh(), { otpLength: 5 })).toMatch(/between 6 and 10/)
    expect(applyAuthSettingsPatch(fresh(), { otpLength: 11 })).toMatch(/between 6 and 10/)
    expect(applyAuthSettingsPatch(fresh(), { minPasswordLength: 3 })).toMatch(/between 4 and 72/)
    expect(applyAuthSettingsPatch(fresh(), { otpExpirySeconds: 0 })).toMatch(/>= 1/)
    expect(applyAuthSettingsPatch(fresh(), { maxEnrolledFactors: 0 })).toMatch(/>= 1/)
  })

  it('clamps a valid-but-out-of-canonical value via sanitize (otpLength floored)', () => {
    const s = fresh()
    expect(applyAuthSettingsPatch(s, { otpLength: 7.9 })).toBeNull()
    expect(s.otpLength).toBe(7)
  })
})
