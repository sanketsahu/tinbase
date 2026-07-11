import { SubNav } from '../../components/layout'
import { navigate, useRoute } from '../../lib/router'
import { ProvidersSection } from './providers'
import { UsersSection } from './users'

const SECTIONS = [
  { id: 'users', label: 'Users', group: 'Manage', component: UsersSection },
  { id: 'providers', label: 'Sign In / Providers', group: 'Configuration', component: ProvidersSection },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Authentication section: user management + provider configuration. */
export function Authentication() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : 'users'
  const Active = SECTIONS.find((s) => s.id === active)!.component

  return (
    <div className="flex h-full">
      <SubNav
        title="Authentication"
        active={active}
        onSelect={(id) => navigate('auth', id)}
        groups={[
          { title: 'Manage', items: [{ id: 'users', label: 'Users' }] },
          { title: 'Configuration', items: [{ id: 'providers', label: 'Sign In / Providers' }] },
        ]}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Active />
      </div>
    </div>
  )
}
