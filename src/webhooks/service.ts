/**
 * Database webhooks - fire an HTTP request when rows change, the tinbase
 * equivalent of Supabase Database Webhooks (which use pg_net under the hood).
 * Built on the existing CDC pipeline (triggers + pg_notify), so it needs no C
 * extension and works on both engines. The POST body matches Supabase's
 * webhook payload exactly: { type, table, schema, record, old_record }.
 */
import type { CdcEvent, Database } from '../db/database.js'
import { blockedNetTarget } from '../net/service.js'

/** A registered database webhook: which changes to watch and where to POST them. */
export interface WebhookConfig {
  /** table to watch */
  table: string
  /** schema of the watched table; defaults to 'public' */
  schema?: string
  /** which events fire the hook; default all */
  events?: ('INSERT' | 'UPDATE' | 'DELETE')[]
  /** destination URL */
  url: string
  /** HTTP method (default POST) */
  method?: string
  /** extra headers (e.g. an auth token) */
  headers?: Record<string, string>
  /** request timeout ms (default 5000) */
  timeoutMs?: number
}

/** Result of one webhook delivery attempt, passed to the optional `onDelivery` callback. */
export interface WebhookDelivery {
  webhook: WebhookConfig
  /** the CDC event that triggered this delivery */
  event: CdcEvent
  /** HTTP response status; null when the request never got a reply (error/blocked) */
  status: number | null
  /** true when the response was 2xx */
  ok: boolean
  /** failure reason (network error, blocked SSRF target); undefined on success */
  error?: string
}

/** Watches the CDC stream and POSTs matching row changes to registered webhooks. */
export class WebhooksService {
  private hooks: WebhookConfig[] = []
  private stop: (() => void) | null = null
  private started = false

  constructor(
    private db: Database,
    private fetchImpl: typeof fetch = fetch,
    private onDelivery?: (d: WebhookDelivery) => void,
    /**
     * Block delivery to loopback/private/link-local targets (SSRF guard). Off by
     * default so local dev can point a webhook at a local edge function, as
     * `supabase start` does; the backend turns it on when network-exposed.
     */
    private restrictTargets = false
  ) {}

  /** All currently registered webhooks. */
  list(): WebhookConfig[] {
    return [...this.hooks]
  }

  /** Register a webhook (ensures the CDC trigger + subscription are live). */
  async register(hook: WebhookConfig): Promise<void> {
    this.hooks.push(hook)
    await this.db.ensureCdcTrigger(hook.schema ?? 'public', hook.table).catch(() => {})
    await this.ensureStarted()
  }

  /** Register an initial set of webhooks and start dispatching if any exist. */
  async start(initial: WebhookConfig[] = []): Promise<void> {
    for (const h of initial) {
      this.hooks.push(h)
      await this.db.ensureCdcTrigger(h.schema ?? 'public', h.table).catch(() => {})
    }
    if (this.hooks.length > 0) await this.ensureStarted()
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return
    this.started = true
    this.stop = await this.db.onCdcEvent((e) => this.dispatch(e))
  }

  /** Unsubscribe from the CDC stream; registered hooks are retained. */
  stopService(): void {
    this.stop?.()
    this.stop = null
    this.started = false
  }

  private dispatch(event: CdcEvent): void {
    for (const hook of this.hooks) {
      if ((hook.schema ?? 'public') !== event.schema) continue
      if (hook.table !== event.table) continue
      const events = hook.events ?? ['INSERT', 'UPDATE', 'DELETE']
      if (!events.includes(event.type)) continue
      void this.deliver(hook, event)
    }
  }

  private async deliver(hook: WebhookConfig, event: CdcEvent): Promise<void> {
    const payload = {
      type: event.type,
      table: event.table,
      schema: event.schema,
      record: event.record ?? null,
      old_record: event.old_record ?? null,
    }
    const blocked = this.restrictTargets ? blockedNetTarget(hook.url) : null
    if (blocked) {
      this.onDelivery?.({ webhook: hook, event, status: null, ok: false, error: blocked })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), hook.timeoutMs ?? 5000)
    try {
      const res = await this.fetchImpl(hook.url, {
        method: hook.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...(hook.headers ?? {}) },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      this.onDelivery?.({ webhook: hook, event, status: res.status, ok: res.ok })
    } catch (e) {
      this.onDelivery?.({
        webhook: hook,
        event,
        status: null,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      })
    } finally {
      clearTimeout(timer)
    }
  }
}
