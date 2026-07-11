import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Empty, Spinner, Table, Td, Th, THead, Time, TRow } from '../../components/ui'
import { CatalogHeader } from '../database/shared'

interface Hook {
  table: string
  events?: string[]
  url: string
}

interface Delivery {
  id: number
  status_code: number | null
  timed_out: boolean | null
  error_msg: string | null
  created: string
}

/** Configured database webhooks + recent outbound HTTP deliveries (pg_net). */
export function WebhooksSection() {
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])

  const load = useCallback(async () => {
    const [h, d] = await Promise.allSettled([
      api.webhooksConfig(),
      api.sql(`select id, status_code, timed_out, error_msg, created from net._http_response order by id desc limit 50`),
    ])
    setHooks(h.status === 'fulfilled' ? h.value : [])
    setDeliveries(d.status === 'fulfilled' && d.value.ok ? ((d.value.rows ?? []) as Delivery[]) : [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (hooks === null) return <Spinner />

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Webhooks"
        description="Fire HTTP requests on table changes (CDC → HTTP) — configured via supabase/webhooks.json or createBackend({ webhooks })."
        onRefresh={() => void load()}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table>
          <THead>
            <tr>
              <Th>Table</Th>
              <Th>Events</Th>
              <Th>URL</Th>
            </tr>
          </THead>
          <tbody>
            {hooks.map((h, i) => (
              <TRow key={i}>
                <Td className="font-mono text-foreground/90">{h.table}</Td>
                <Td>
                  <span className="flex gap-1">
                    {(h.events?.length ? h.events : ['INSERT', 'UPDATE', 'DELETE']).map((e) => (
                      <Badge key={e} variant="blue">
                        {e}
                      </Badge>
                    ))}
                  </span>
                </Td>
                <Td className="max-w-90 truncate font-mono text-[12px] text-muted-foreground" title={h.url}>
                  {h.url}
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {hooks.length === 0 && (
          <Empty>
            No webhooks configured. Add <code className="text-muted-foreground">supabase/webhooks.json</code> —{' '}
            <code className="text-muted-foreground">[{'{ "table": "orders", "url": "https://…" }'}]</code> — and restart.
          </Empty>
        )}

        <h2 className="border-b border-border px-6 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Recent outbound requests (pg_net + webhooks)
        </h2>
        <Table>
          <THead>
            <tr>
              <Th>id</Th>
              <Th>Status</Th>
              <Th>Error</Th>
              <Th>At</Th>
            </tr>
          </THead>
          <tbody>
            {deliveries.map((d) => (
              <TRow key={d.id}>
                <Td className="font-mono text-muted-foreground">{d.id}</Td>
                <Td>
                  {d.timed_out ? (
                    <Badge variant="red">timeout</Badge>
                  ) : d.status_code && d.status_code < 400 ? (
                    <Badge variant="brand">{d.status_code}</Badge>
                  ) : (
                    <Badge variant="red">{d.status_code ?? 'error'}</Badge>
                  )}
                </Td>
                <Td className="max-w-90 truncate font-mono text-[11px] text-muted-foreground/80">{d.error_msg ?? '—'}</Td>
                <Td className="text-muted-foreground">
                  <Time value={d.created} />
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {deliveries.length === 0 && <Empty>No outbound requests recorded yet.</Empty>}
      </div>
    </div>
  )
}
