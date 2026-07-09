/**
 * In-process HTTP sender for the pg_net emulation — the execution half of the
 * net.* surface (the net.http_get/post/delete SQL functions live in
 * db/emulated.ts). It drains net.http_request_queue, performs each request with
 * fetch, and records the reply in net._http_response, mirroring pg_net's
 * background worker. No C extension, works on the wasm and native engines.
 */
import type { Database } from '../db/database.js'

/** Cap on the response body we buffer into net._http_response (bytes). */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024

/**
 * Reject requests to non-public destinations. This is a literal-host guard
 * (loopback / private / link-local / cloud-metadata), which blocks the common
 * SSRF vectors without an async DNS lookup. Returns an error string, or null
 * when the URL is allowed.
 */
export function blockedNetTarget(rawUrl: string): string | null {
  let u: URL
  try {
    u = new URL(rawUrl)
  } catch {
    return 'invalid url'
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return `unsupported scheme: ${u.protocol}`
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'blocked host: localhost'
  if (isPrivateIp(host)) return `blocked host: ${host}`
  return null
}

function isPrivateIp(host: string): boolean {
  // IPv4
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 0 || a === 10 || a === 127) return true // this-host, private, loopback
    if (a === 169 && b === 254) return true // link-local (incl. 169.254.169.254 metadata)
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    return false
  }
  // IPv6
  if (host === '::' || host === '::1') return true // unspecified / loopback
  if (host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) return true // link-local / ULA
  if (host.startsWith('::ffff:')) return isPrivateIp(host.slice(7)) // IPv4-mapped
  return false
}

interface RequestRow {
  id: number
  method: string
  url: string
  headers: Record<string, string> | string | null
  body: string | null
  timeout_milliseconds: number
}

export interface NetDelivery {
  id: number
  method: string
  url: string
  status?: number
  timedOut: boolean
  error?: string
}

export class NetService {
  private timer: ReturnType<typeof setInterval> | null = null
  private draining = false

  constructor(
    private db: Database,
    private fetchImpl: typeof fetch = fetch,
    /** how often to drain the queue (ms) */
    private tickMs = 500,
    private onDeliver?: (d: NetDelivery) => void
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.tickMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) (this.timer as { unref: () => void }).unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Drain any queued requests once (also callable directly in tests). */
  async tick(): Promise<void> {
    if (this.draining) return // never overlap drains — one writer at a time
    this.draining = true
    try {
      let rows: RequestRow[]
      try {
        rows = (
          await this.db.query<RequestRow>(
            `select id, method, url, headers, body, timeout_milliseconds from net.http_request_queue order by id limit 20`
          )
        ).rows
      } catch {
        return // net.* not present (e.g. the pg-mem subset engine)
      }
      for (const row of rows) await this.deliver(row)
    } finally {
      this.draining = false
    }
  }

  private async deliver(row: RequestRow): Promise<void> {
    const headers =
      typeof row.headers === 'string' ? (JSON.parse(row.headers) as Record<string, string>) : row.headers ?? {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), row.timeout_milliseconds || 5000)

    let status: number | null = null
    let contentType: string | null = null
    let content: string | null = null
    let respHeaders: Record<string, string> | null = null
    let timedOut = false
    let errorMsg: string | null = null

    const blocked = blockedNetTarget(row.url)
    if (blocked) {
      clearTimeout(timer)
      await this.record(row.id, null, null, null, content, false, blocked)
      this.onDeliver?.({ id: row.id, method: row.method, url: row.url, timedOut: false, error: blocked })
      return
    }

    try {
      const hasBody = row.method !== 'GET' && row.method !== 'HEAD'
      const res = await this.fetchImpl(row.url, {
        method: row.method,
        headers,
        body: hasBody ? row.body ?? undefined : undefined,
        signal: controller.signal,
      })
      status = res.status
      contentType = res.headers.get('content-type')
      respHeaders = Object.fromEntries(res.headers.entries())
      content = await readCapped(res, MAX_RESPONSE_BYTES)
    } catch (e) {
      if (controller.signal.aborted) timedOut = true
      errorMsg = e instanceof Error ? e.message : String(e)
    } finally {
      clearTimeout(timer)
    }

    await this.record(row.id, status, contentType, respHeaders, content, timedOut, errorMsg)
    this.onDeliver?.({
      id: row.id,
      method: row.method,
      url: row.url,
      status: status ?? undefined,
      timedOut,
      error: errorMsg ?? undefined,
    })
  }

  /** Record the response and remove the request from the queue (best-effort). */
  private async record(
    id: number,
    status: number | null,
    contentType: string | null,
    respHeaders: Record<string, string> | null,
    content: string | null,
    timedOut: boolean,
    errorMsg: string | null
  ): Promise<void> {
    try {
      await this.db.query(
        `insert into net._http_response (id, status_code, content_type, headers, content, timed_out, error_msg)
         values ($1, $2, $3, $4::jsonb, $5, $6, $7) on conflict (id) do nothing`,
        [id, status, contentType, respHeaders ? JSON.stringify(respHeaders) : null, content, timedOut, errorMsg]
      )
      await this.db.query(`delete from net.http_request_queue where id = $1`, [id])
    } catch {
      // if recording fails, leave the row so the next tick retries
    }
  }
}

/** Read a response body as text, truncating at `maxBytes` to bound memory. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.length
  }
  await reader.cancel().catch(() => {})
  let merged = new Uint8Array(Math.min(total, maxBytes))
  let offset = 0
  for (const c of chunks) {
    const take = Math.min(c.length, merged.length - offset)
    merged.set(c.subarray(0, take), offset)
    offset += take
    if (offset >= merged.length) break
  }
  return new TextDecoder().decode(merged)
}
