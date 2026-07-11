import { ExternalLink, Globe, Inbox, KeyRound, Mail, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type AuthSettings } from '../../api'
import { Badge, Input, Spinner, Switch, toast } from '../../components/ui'
import { apiUrl } from '../../lib/snippet'

interface Config {
  providers: string[]
  inbox: boolean
  settings: AuthSettings | null
}

/**
 * Sign In / Providers: live toggles for signups, anonymous users, email
 * confirmation and password length, plus per-OAuth-provider switches.
 * Every change saves instantly through the admin API and takes effect
 * on the next auth request — no restart.
 */
export function ProvidersSection() {
  const [config, setConfig] = useState<Config | null>(null)

  useEffect(() => {
    api.authConfig().then(setConfig, () => setConfig({ providers: [], inbox: false, settings: null }))
  }, [])

  if (config === null) return <Spinner />
  const settings = config.settings

  /** Optimistically apply a patch, then persist; roll back on failure. */
  async function patch(p: Partial<AuthSettings>) {
    if (!settings) return
    const prev = { ...settings, disabledProviders: [...settings.disabledProviders] }
    setConfig((c) => (c && c.settings ? { ...c, settings: { ...c.settings, ...p } } : c))
    try {
      const saved = await api.updateAuthSettings(p)
      setConfig((c) => (c ? { ...c, settings: saved } : c))
    } catch (e) {
      setConfig((c) => (c ? { ...c, settings: prev } : c))
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 py-8">
        <h1 className="text-lg font-semibold text-foreground">Sign In / Providers</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground/80">
          Changes apply instantly to the running instance and persist across restarts.
        </p>

        {/* ── user signups ── */}
        <h2 className="mb-2 mt-7 text-sm font-medium text-foreground">User signups</h2>
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          <SettingRow
            title="Allow new users to sign up"
            description="If disabled, new email/password and OTP signups are rejected; existing users can still sign in."
          >
            <Switch checked={settings ? !settings.disableSignup : true} onChange={(on) => void patch({ disableSignup: !on })} disabled={!settings} />
          </SettingRow>
          <SettingRow
            title="Allow anonymous sign-ins"
            description="Enable signInAnonymously() — temporary users without credentials."
          >
            <Switch checked={settings?.anonymousUsers ?? true} onChange={(on) => void patch({ anonymousUsers: on })} disabled={!settings} />
          </SettingRow>
          <SettingRow
            title="Confirm email"
            description="Require users to verify their email address (via the emailed link or code) before they can sign in."
          >
            <Switch checked={settings ? !settings.autoconfirm : false} onChange={(on) => void patch({ autoconfirm: !on })} disabled={!settings} />
          </SettingRow>
          <SettingRow title="Minimum password length" description="Passwords shorter than this are rejected on signup and password change (4–72).">
            <MinLengthInput value={settings?.minPasswordLength ?? 6} disabled={!settings} onSave={(n) => void patch({ minPasswordLength: n })} />
          </SettingRow>
        </div>

        {/* ── auth methods ── */}
        <h2 className="mb-2 mt-8 text-sm font-medium text-foreground">Auth methods</h2>
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          <ProviderRow icon={Mail} name="Email" description="Email/password, OTP codes, magic links, and password recovery.">
            <Badge variant="brand">Enabled</Badge>
          </ProviderRow>
          <ProviderRow icon={KeyRound} name="PKCE flows" description="OAuth and magic links support the PKCE flow out of the box.">
            <Badge variant="brand">Enabled</Badge>
          </ProviderRow>
          <ProviderRow icon={UserRound} name="Anonymous" description="Temporary users without credentials — controlled by the toggle above.">
            {settings?.anonymousUsers === false ? <Badge variant="neutral">Disabled</Badge> : <Badge variant="brand">Enabled</Badge>}
          </ProviderRow>
        </div>

        {/* ── oauth providers ── */}
        <h2 className="mb-2 mt-8 text-sm font-medium text-foreground">OAuth providers</h2>
        {config.providers.length > 0 ? (
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {config.providers.map((p) => {
              const enabled = !settings?.disabledProviders.includes(p)
              return (
                <ProviderRow key={p} icon={Globe} name={p} description="signInWithOAuth() with identity linking." oauth>
                  <Switch
                    checked={enabled}
                    disabled={!settings}
                    onChange={(on) => {
                      if (!settings) return
                      const next = on ? settings.disabledProviders.filter((x) => x !== p) : [...settings.disabledProviders, p]
                      void patch({ disabledProviders: next })
                    }}
                  />
                </ProviderRow>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground/80">
            No OAuth providers configured. Add Google/GitHub (or a generic provider) to{' '}
            <code className="text-muted-foreground">supabase/config.toml</code> and restart — they appear here with a toggle.
          </div>
        )}

        {/* ── email delivery ── */}
        <h2 className="mb-2 mt-8 text-sm font-medium text-foreground">Email delivery</h2>
        <div className="flex items-center gap-3 rounded-md border border-border bg-card p-4">
          <Inbox size={16} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-foreground">
              {config.inbox ? 'Local dev inbox' : 'Custom mailer'} {config.inbox && <Badge variant="brand">active</Badge>}
            </p>
            <p className="text-[11px] text-muted-foreground/80">
              {config.inbox
                ? 'No mailer configured — OTP codes, magic links and confirmations are captured locally instead of being sent.'
                : 'A mailer was provided to createBackend; emails are delivered through it.'}
            </p>
          </div>
          {config.inbox && (
            <a
              href={`${apiUrl()}/inbox`}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-foreground/80 transition-colors hover:border-muted-foreground hover:text-foreground"
            >
              Open inbox <ExternalLink size={11} />
            </a>
          )}
        </div>

        {settings === null && (
          <p className="mt-6 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            This server predates runtime auth settings — restart tinbase after updating to enable the toggles.
          </p>
        )}
      </div>
    </div>
  )
}

/* ── pieces ── */

function SettingRow({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{title}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function ProviderRow({
  icon: Icon,
  name,
  description,
  oauth,
  children,
}: {
  icon: typeof Mail
  name: string
  description: string
  oauth?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 p-4">
      <Icon size={16} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[13px] capitalize text-foreground">
          {name}
          {oauth && <Badge variant="blue">oauth</Badge>}
        </p>
        <p className="text-[11px] text-muted-foreground/80">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Small numeric input that saves on blur or Enter and snaps back on invalid values. */
function MinLengthInput({ value, disabled, onSave }: { value: number; disabled?: boolean; onSave: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  function commit() {
    const n = parseInt(text, 10)
    if (!Number.isFinite(n) || n < 4 || n > 72) {
      setText(String(value))
      return
    }
    if (n !== value) onSave(n)
  }

  return (
    <Input
      mono
      className="w-16 text-center"
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
