import { SubNav } from '../../components/layout'
import { navigate, useRoute } from '../../lib/router'
import { CronSection } from './cron'
import { QueuesSection } from './queues'
import { WebhooksSection } from './webhooks'

const SECTIONS = [
  { id: 'cron', label: 'Cron', component: CronSection },
  { id: 'queues', label: 'Queues', component: QueuesSection },
  { id: 'webhooks', label: 'Webhooks', component: WebhooksSection },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Automations: cron jobs, pgmq queues, and database webhooks — all native. */
export function Automations() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.some((s) => s.id === section) ? (section as SectionId) : 'cron'
  const Active = SECTIONS.find((s) => s.id === active)!.component

  return (
    <div className="flex h-full">
      <SubNav
        title="Automations"
        active={active}
        onSelect={(id) => navigate('automations', id)}
        groups={[{ items: SECTIONS.map((s) => ({ id: s.id, label: s.label })) }]}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <Active />
      </div>
    </div>
  )
}
