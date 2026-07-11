import { useEffect, useState } from 'react'
import { api, getKey } from '../../api'
import { CopyButton, Input, KeyField } from '../../components/ui'
import { apiUrl } from '../../lib/snippet'
import { SettingsRow, SettingsSection } from './shared'

/** Connection URL + the anon / service_role API keys. */
export function ApiKeysSettings() {
  const [anonKey, setAnonKey] = useState('')
  const url = apiUrl()

  useEffect(() => {
    api.keys().then(
      (k) => setAnonKey(k.anonKey ?? ''),
      () => setAnonKey('')
    )
  }, [])

  return (
    <SettingsSection
      title="API keys"
      description="Long-lived JWTs signed with the project's JWT secret. Rotating the secret invalidates both."
    >
      <SettingsRow label="Project URL" description="Point supabase-js (or any HTTP client) here.">
        <div className="flex items-center gap-2">
          <Input mono readOnly value={url} />
          <CopyButton value={url} label="API URL" variant="outline" size="icon" iconSize={13} />
        </div>
      </SettingsRow>
      <SettingsRow label="anon key" description="Safe for browsers — Row Level Security applies to every request.">
        <KeyField bare label="anon key" hint="" value={anonKey} />
      </SettingsRow>
      <SettingsRow
        label="service_role key"
        description={<span className="text-destructive/80">Server-side only — bypasses Row Level Security.</span>}
      >
        <KeyField bare label="service_role key" hint="" value={getKey()} danger />
      </SettingsRow>
      <SettingsRow label="CLI" description="Keys are also printed on startup.">
        <code className="rounded bg-code px-2 py-1 font-mono text-xs text-foreground/90">tinbase keys</code>
      </SettingsRow>
    </SettingsSection>
  )
}
