/**
 * Minimal Phoenix-protocol (v1 JSON) realtime client for the inspector —
 * enough to join a channel, listen to postgres_changes / broadcast / presence,
 * and send broadcast messages over tinbase's real WebSocket endpoint.
 */

export type MessageDir = 'in' | 'out' | 'sys'

export interface RtMessage {
  dir: MessageDir
  ts: number
  event: string
  topic?: string
  payload: unknown
}

export type RtStatus = 'connecting' | 'open' | 'joined' | 'closed' | 'error'

export interface RealtimeOptions {
  /** http(s) origin of the tinbase server */
  baseUrl: string
  /** apikey / access token (anon or service_role JWT) */
  token: string
  /** channel name (joined as topic `realtime:<name>`) */
  channel: string
  /** subscribe to postgres_changes */
  listenChanges: boolean
  schema: string
  /** empty → all tables in the schema */
  table?: string
  onMessage: (m: RtMessage) => void
  onStatus: (s: RtStatus) => void
}

export interface RealtimeConnection {
  sendBroadcast: (event: string, payload: unknown) => void
  close: () => void
}

const HEARTBEAT_MS = 25_000

export function connectRealtime(opts: RealtimeOptions): RealtimeConnection {
  const wsBase = opts.baseUrl.replace(/^http/, 'ws')
  const url = `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(opts.token)}&vsn=1.0.0`
  const topic = `realtime:${opts.channel}`
  let ref = 0
  const nextRef = () => String(++ref)
  let joinRef: string | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closedByUser = false

  opts.onStatus('connecting')
  const ws = new WebSocket(url)

  const send = (msg: { topic: string; event: string; payload: unknown; ref: string }) => {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(msg))
    opts.onMessage({ dir: 'out', ts: Date.now(), event: msg.event, topic: msg.topic, payload: msg.payload })
  }

  ws.onopen = () => {
    opts.onStatus('open')
    const postgres_changes = opts.listenChanges
      ? [{ event: '*', schema: opts.schema, ...(opts.table ? { table: opts.table } : {}) }]
      : []
    joinRef = nextRef()
    send({
      topic,
      event: 'phx_join',
      ref: joinRef,
      payload: {
        config: {
          broadcast: { self: true },
          presence: { key: `studio-${Math.floor(performance.now()).toString(36)}` },
          postgres_changes,
        },
        access_token: opts.token,
      },
    })
    heartbeat = setInterval(() => {
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() })
    }, HEARTBEAT_MS)
  }

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as { topic: string; event: string; payload: unknown; ref: string | null }
      // suppress heartbeat replies from the feed — pure noise
      if (msg.topic === 'phoenix') return
      if (msg.event === 'phx_reply' && msg.ref === joinRef) {
        const ok = (msg.payload as { status?: string })?.status === 'ok'
        opts.onStatus(ok ? 'joined' : 'error')
      }
      opts.onMessage({ dir: 'in', ts: Date.now(), event: msg.event, topic: msg.topic, payload: msg.payload })
    } catch {
      opts.onMessage({ dir: 'in', ts: Date.now(), event: 'raw', payload: String(e.data) })
    }
  }

  ws.onerror = () => {
    if (!closedByUser) opts.onStatus('error')
  }
  ws.onclose = () => {
    if (heartbeat) clearInterval(heartbeat)
    opts.onStatus('closed')
  }

  return {
    sendBroadcast: (event, payload) => {
      send({ topic, event: 'broadcast', ref: nextRef(), payload: { type: 'broadcast', event, payload } })
    },
    close: () => {
      closedByUser = true
      if (heartbeat) clearInterval(heartbeat)
      try {
        send({ topic, event: 'phx_leave', payload: {}, ref: nextRef() })
      } finally {
        ws.close()
      }
    },
  }
}
