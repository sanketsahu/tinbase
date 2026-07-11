import { SubNav } from '../../components/layout'
import { navigate, useRoute } from '../../lib/router'
import { EnumsSection } from './enums'
import { FunctionsSection } from './functions'
import { IndexesSection } from './indexes'
import { MigrationsSection } from './migrations'
import { PoliciesSection } from './policies'
import { RolesSection } from './roles'
import { TablesSection } from './tables'
import { TriggersSection } from './triggers'
import { VisualizerSection } from './visualizer'

const SECTIONS = [
  { id: 'visualizer', label: 'Schema Visualizer', component: VisualizerSection },
  { id: 'tables', label: 'Tables', component: TablesSection },
  { id: 'functions', label: 'Functions', component: FunctionsSection },
  { id: 'triggers', label: 'Triggers', component: TriggersSection },
  { id: 'enums', label: 'Enumerated Types', component: EnumsSection },
  { id: 'indexes', label: 'Indexes', component: IndexesSection },
  { id: 'migrations', label: 'Migrations', component: MigrationsSection },
  { id: 'policies', label: 'Policies', component: PoliciesSection },
  { id: 'roles', label: 'Roles', component: RolesSection },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Database section: catalog browsers grouped under a shared sub-nav. */
export function DatabaseSection() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : 'visualizer'
  const Active = SECTIONS.find((s) => s.id === active)!.component

  return (
    <div className="flex h-full">
      <SubNav
        title="Database"
        active={active}
        onSelect={(id) => navigate('database', id)}
        groups={[
          {
            title: 'Database Management',
            items: SECTIONS.slice(0, 7).map((s) => ({ id: s.id, label: s.label })),
          },
          {
            title: 'Access Control',
            items: SECTIONS.slice(7).map((s) => ({ id: s.id, label: s.label })),
          },
        ]}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Active />
      </div>
    </div>
  )
}
