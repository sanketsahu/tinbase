import { useEffect, useState } from 'react'
import { api, type Stats } from '../../api'
import { Badge, Spinner } from '../../components/ui'
import { Fact, SettingsRow, SettingsSection } from './shared'

const Path = ({ children }: { children: string }) => (
  <code className="rounded bg-code px-1 py-px font-mono text-foreground/90">{children}</code>
)

/** Read-only view of what this tinbase instance is running on. */
export function InfrastructureSettings() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [healthy, setHealthy] = useState<boolean | null>(null)

  useEffect(() => {
    api.stats().then(
      (s) => {
        setStats(s)
        setHealthy(true)
      },
      () => setHealthy(false)
    )
  }, [])

  if (stats === null && healthy === null) return <Spinner />

  return (
    <>
      <SettingsSection title="Instance" description="One process — embedded Postgres, no Docker.">
        <SettingsRow label="Status" description="Whether the admin API responds.">
          {healthy ? <Badge variant="brand">Healthy</Badge> : <Badge variant="red">Unreachable</Badge>}
        </SettingsRow>
        <SettingsRow label="Database" description="Engine version and current on-disk size.">
          <Fact label="Postgres" value={stats?.version ?? '—'} />
          <Fact label="Size" value={stats?.dbSize ?? '—'} />
          <Fact label="Tables (public)" value={stats?.tables ?? '—'} />
          <Fact label="Applied migrations" value={stats?.migrations ?? '—'} />
        </SettingsRow>
        <SettingsRow label="Services" description="Counts across auth and storage.">
          <Fact label="Auth users" value={stats?.users ?? '—'} />
          <Fact label="Buckets" value={stats?.buckets ?? '—'} />
          <Fact label="Objects" value={stats?.objects ?? '—'} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Data locations" description="Configured by CLI flags when starting tinbase.">
        <SettingsRow label="On disk" description="Where this project's data lives, relative to the project directory.">
          <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
            <p>
              Database: <Path>.tinbase/db</Path> (PGlite) or <Path>.tinbase/pgdata</Path> (native)
            </p>
            <p>
              Storage objects: <Path>.tinbase/storage</Path>
            </p>
            <p>
              Override with <Path>--data-dir</Path> / <Path>--storage-dir</Path> · wipe + reseed with <Path>tinbase db reset</Path>
            </p>
          </div>
        </SettingsRow>
      </SettingsSection>
    </>
  )
}
