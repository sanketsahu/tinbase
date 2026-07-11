import { SubNav } from '../../components/layout'
import { navigate, useRoute } from '../../lib/router'
import { ApiKeysSettings } from './api-keys'
import { GeneralSettings } from './general'
import { InfrastructureSettings } from './infrastructure'
import { JwtSettings } from './jwt-keys'

const SECTIONS = [
  { id: 'general', label: 'General', component: GeneralSettings },
  { id: 'infrastructure', label: 'Infrastructure', component: InfrastructureSettings },
  { id: 'api-keys', label: 'API Keys', component: ApiKeysSettings },
  { id: 'jwt', label: 'JWT Keys', component: JwtSettings },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Project Settings: sectioned configuration behind /_/settings/<section>. */
export function SettingsPage() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : 'general'
  const Active = SECTIONS.find((s) => s.id === active)!.component

  return (
    <div className="flex h-full">
      <SubNav
        title="Project Settings"
        active={active}
        onSelect={(id) => navigate('settings', id)}
        groups={[{ items: SECTIONS.map((s) => ({ id: s.id, label: s.label })) }]}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl px-10 py-8">
          <h1 className="border-b border-border pb-4 text-xl font-semibold text-foreground">
            {SECTIONS.find((s) => s.id === active)!.label}
          </h1>
          <Active />
        </div>
      </div>
    </div>
  )
}
