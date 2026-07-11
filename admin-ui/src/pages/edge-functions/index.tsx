import { MoreVertical, Play, Plus, RefreshCw, Trash2, Zap } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { SettingsRow, SettingsSection as SettingsSectionRow, SettingsShell, SubNav } from '../../components/layout'
import {
  Badge,
  Button,
  ConfirmDialog,
  CopyButton,
  Empty,
  Input,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Spinner,
  Table,
  Td,
  Th,
  THead,
  Textarea,
  toast,
  TRow,
} from '../../components/ui'
import { navigate, useRoute } from '../../lib/router'
import { apiUrl } from '../../lib/snippet'
import { InvokeTester } from './invoke-tester'

const SECTIONS = ['functions', 'secrets', 'settings'] as const
type SectionId = (typeof SECTIONS)[number]

/** Edge Functions: loaded handlers + invoke tester, injected secrets, and runtime settings. */
export function EdgeFunctions() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.includes(section as SectionId) ? (section as SectionId) : 'functions'

  return (
    <div className="flex h-full">
      <SubNav
        title="Edge Functions"
        active={active}
        onSelect={(id) => navigate('functions', id)}
        groups={[
          { title: 'Manage', items: [{ id: 'functions', label: 'Functions' }] },
          {
            title: 'Configuration',
            items: [
              { id: 'secrets', label: 'Secrets' },
              { id: 'settings', label: 'Settings' },
            ],
          },
        ]}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {active === 'functions' && <FunctionsSection />}
        {active === 'secrets' && <SecretsSection />}
        {active === 'settings' && <SettingsSection />}
      </div>
    </div>
  )
}

/* ── functions list + invoke tester ── */

function FunctionsSection() {
  const [functions, setFunctions] = useState<string[] | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  const load = useCallback(() => {
    api.edgeFunctions().then(
      (r) => setFunctions(r.functions),
      () => setFunctions([])
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (functions === null) return <Spinner />

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-6 pb-4 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Functions</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground/80">
              <code className="text-muted-foreground">Deno.serve</code> / export-default handlers loaded from{' '}
              <code className="text-muted-foreground">supabase/functions/&lt;name&gt;/index.ts</code> — running in-process.
            </p>
          </div>
          <Button variant="ghost" size="iconXs" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {functions.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md rounded-lg border border-dashed border-border px-10 py-8 text-center">
              <Zap size={20} className="mx-auto text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium text-foreground">No functions loaded</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">
                Create <code className="text-muted-foreground">supabase/functions/hello/index.ts</code> with a{' '}
                <code className="text-muted-foreground">Deno.serve(handler)</code> and restart tinbase — it appears here and is
                served at <code className="text-muted-foreground">/functions/v1/hello</code>.
              </p>
            </div>
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>URL</Th>
                <Th className="w-24" />
              </tr>
            </THead>
            <tbody>
              {functions.map((name) => {
                const url = `${apiUrl()}/functions/v1/${name}`
                return (
                  <TRow key={name}>
                    <Td className="font-mono text-foreground/90">{name}</Td>
                    <Td>
                      <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                        <span className="truncate">{url}</span>
                        <CopyButton value={url} label={`${name} URL`} iconSize={11} />
                      </span>
                    </Td>
                    <Td>
                      <Button variant="outline" size="xs" onClick={() => setTesting(name)}>
                        <Play size={11} /> Invoke
                      </Button>
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </Table>
        )}
        {functions.length > 0 && <Empty>Invoke runs the function through the real HTTP path with the key/role you pick.</Empty>}
      </div>

      {testing && <InvokeTester name={testing} onClose={() => setTesting(null)} />}
    </div>
  )
}

/* ── secrets: add/replace form + custom secrets (with digest) + built-in reference ── */

/** Descriptions for the env vars tinbase actually injects — no cloud-only placeholders. */
const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  SUPABASE_URL: 'The in-process API gateway for this tinbase instance.',
  SUPABASE_ANON_KEY: 'Anon JWT — safe in a browser when RLS is enabled.',
  SUPABASE_SERVICE_ROLE_KEY: 'Service-role JWT — bypasses RLS, keep server-side only.',
}

type SecretRow = { name: string; digest: string }

function SecretsSection() {
  const [data, setData] = useState<{ builtins: string[]; custom: SecretRow[] } | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    api.edgeFunctions().then(
      (r) => {
        const builtins = new Set(r.builtins)
        const custom = Object.keys(r.env)
          .filter((k) => !builtins.has(k))
          .sort((a, b) => a.localeCompare(b))
          .map((name) => ({ name, digest: r.digests[name] ?? '' }))
        setData({ builtins: r.builtins, custom })
      },
      () => setData({ builtins: [], custom: [] })
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (data === null) return <Spinner />

  const filtered = query.trim()
    ? data.custom.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    : data.custom

  return (
    <SettingsShell title="Edge Function Secrets">
      <AddSecretForm existing={new Set([...data.builtins, ...data.custom.map((s) => s.name)])} onSaved={load} />

      <SettingsSectionRow
        title="Custom secrets"
        description="Runtime secrets you've set for this instance. Applied live to Deno.env — no restart. Not written back to supabase/functions/.env, so a restart reloads from that file."
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground/70">
            {data.custom.length} secret{data.custom.length === 1 ? '' : 's'}
          </p>
          {data.custom.length > 0 && (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a secret"
              className="h-8 w-56 text-xs"
            />
          )}
        </div>
        {data.custom.length === 0 ? (
          <p className="py-6 text-xs text-muted-foreground/60">No custom secrets yet. Add one above.</p>
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>
                  Digest <Badge variant="neutral">SHA256</Badge>
                </Th>
                <Th className="w-10" />
              </tr>
            </THead>
            <tbody>
              {filtered.map((s) => (
                <SecretRowView key={s.name} secret={s} onChanged={load} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <Td colSpan={3} className="py-6 text-center text-xs text-muted-foreground/60">
                    No secret matches “{query}”.
                  </Td>
                </tr>
              )}
            </tbody>
          </Table>
        )}
      </SettingsSectionRow>

      <SettingsSectionRow
        title="Built-in secrets"
        description="Injected into every function by tinbase — read-only. These are the vars a local Supabase edge function can rely on here."
      >
        {data.builtins.map((name) => (
          <SettingsRow key={name} label={name} description={BUILTIN_DESCRIPTIONS[name] ?? 'Provided by tinbase.'}>
            <Badge variant="neutral">built-in</Badge>
          </SettingsRow>
        ))}
      </SettingsSectionRow>
    </SettingsShell>
  )
}

/** One custom-secret row: name, digest, and a delete action. */
function SecretRowView({ secret, onChanged }: { secret: SecretRow; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false)

  const del = async () => {
    try {
      await api.deleteSecret(secret.name)
      toast.success(`Deleted ${secret.name}`)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to delete ${secret.name}`)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <TRow>
      <Td>
        <Badge variant="neutral">{secret.name}</Badge>
      </Td>
      <Td>
        <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
          <span className="truncate" title={secret.digest}>
            {secret.digest.slice(0, 48)}…
          </span>
          <CopyButton value={secret.digest} label={`${secret.name} digest`} iconSize={11} />
        </span>
      </Td>
      <Td>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="iconXs" title="Actions">
              <MoreVertical size={13} />
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem danger onSelect={() => setConfirming(true)}>
              <Trash2 size={13} /> Delete secret
            </MenuItem>
          </MenuContent>
        </Menu>
      </Td>
      {confirming && (
        <ConfirmDialog
          open
          danger
          title={`Delete ${secret.name}?`}
          description="Functions will stop seeing this value on the next invocation."
          confirmLabel="Delete"
          onConfirm={() => void del()}
          onClose={() => setConfirming(false)}
        />
      )}
    </TRow>
  )
}

/** Add-or-replace form: one-or-more name/value pairs, saved in a single PUT. */
function AddSecretForm({ existing, onSaved }: { existing: Set<string>; onSaved: () => void }) {
  const [rows, setRows] = useState<{ name: string; value: string }[]>([{ name: '', value: '' }])
  const [saving, setSaving] = useState(false)

  const setRow = (i: number, patch: Partial<{ name: string; value: string }>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const save = async () => {
    const secrets: Record<string, string> = {}
    for (const r of rows) {
      const name = r.name.trim()
      if (!name) continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return toast.error(`Invalid name "${name}" — letters, digits, underscores.`)
      if (existing.has(name) && ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].includes(name))
        return toast.error(`"${name}" is built-in and can't be changed.`)
      secrets[name] = r.value
    }
    if (Object.keys(secrets).length === 0) return toast.error('Enter at least one named secret.')
    setSaving(true)
    try {
      await api.putSecrets(secrets)
      toast.success(`Saved ${Object.keys(secrets).length} secret${Object.keys(secrets).length === 1 ? '' : 's'}`)
      setRows([{ name: '', value: '' }])
      onSaved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save secrets')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSectionRow title="Add or replace secrets" description="Set a secret every function reads via Deno.env.get(). Saving an existing name replaces its value.">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto] items-start gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={r.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                placeholder="e.g. CLIENT_KEY"
                className="mt-1 h-9 font-mono text-xs"
              />
            </div>
            <div>
              <Label>Value</Label>
              <Textarea
                value={r.value}
                onChange={(e) => setRow(i, { value: e.target.value })}
                placeholder="Supports multi-line values such as PEM keys, JSON, or tokens."
                rows={2}
                className="mt-1 font-mono text-xs"
              />
            </div>
            {rows.length > 1 && (
              <Button
                variant="ghost"
                size="iconXs"
                title="Remove row"
                className="mt-6"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <Trash2 size={13} />
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="outline" size="xs" onClick={() => setRows((rs) => [...rs, { name: '', value: '' }])}>
            <Plus size={12} /> Add another
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </SettingsSectionRow>
  )
}

/* ── settings / capabilities ── */

function SettingsSection() {
  const Mono = ({ children }: { children: React.ReactNode }) => (
    <code className="rounded bg-code px-1 py-px font-mono text-foreground/90">{children}</code>
  )
  return (
    <SettingsShell title="Edge Function Settings">
      <SettingsSectionRow title="Runtime" description="How functions execute on this instance.">
        <SettingsRow label="Engine" description="In-process Deno shim — no containers, no cold starts.">
          <span className="text-[13px] text-muted-foreground">
            <Mono>Deno.serve</Mono>, <Mono>Deno.env</Mono>, fetch, WebCrypto
          </span>
        </SettingsRow>
        <SettingsRow label="Loading" description="Functions are discovered at boot; restart tinbase to pick up new or changed code.">
          <span className="text-[13px] text-muted-foreground">
            <Mono>supabase/functions/&lt;name&gt;/index.ts</Mono>
          </span>
        </SettingsRow>
        <SettingsRow label="Invocation" description="Every HTTP method, CORS pre-handled.">
          <span className="text-[13px] text-muted-foreground">
            <Mono>/functions/v1/&lt;name&gt;</Mono>
          </span>
        </SettingsRow>
      </SettingsSectionRow>

      <SettingsSectionRow title="Security" description="What a function sees on each request.">
        <SettingsRow
          label="JWT verification"
          description={
            <>
              The <Mono>Authorization</Mono> header is passed through as-is — verify the JWT inside the function (or trust the
              gateway key), matching <Mono>verify_jwt</Mono>-off Supabase functions.
            </>
          }
        >
          <Badge variant="neutral">pass-through</Badge>
        </SettingsRow>
        <SettingsRow label="Secrets" description="Injected from supabase/functions/.env plus the built-in SUPABASE_* vars.">
          <Button variant="outline" size="xs" onClick={() => navigate('functions', 'secrets')}>
            View secrets
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Database access"
          description={
            <>
              Use supabase-js with <Mono>SUPABASE_URL</Mono> and a key from env — requests loop back through the same backend
              in-process.
            </>
          }
        >
          <Badge variant="brand">in-process</Badge>
        </SettingsRow>
      </SettingsSectionRow>
    </SettingsShell>
  )
}
