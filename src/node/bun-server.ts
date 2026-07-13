/**
 * Bun-native server: Bun.serve with first-class WebSockets. Used automatically
 * when the CLI runs under Bun (including single-binary builds) - same backend,
 * same RealtimeSocketLike contract as the node:http path.
 */
import type { SupaliteBackendShape } from './server-shared.js'
import type { RunningServer, ServeOptions } from './server.js'

declare const Bun: any

/** Per-connection state Bun carries through the websocket lifecycle callbacks. */
interface WsData {
  vsn: string
  /** Realtime session, created on `open` and driven by `message`/`close`. */
  session?: { onMessage: (data: string | Uint8Array) => void; onClose: () => void }
}

/** Bun equivalent of {@link import('./server.js').serve}; same backend contract. */
export async function serveBun(backend: SupaliteBackendShape, opts: ServeOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? '127.0.0.1'

  const server = Bun.serve({
    port: opts.port ?? 54321,
    hostname: host,
    async fetch(req: Request, srv: any) {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/realtime/v1') && req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const ok = srv.upgrade(req, { data: { vsn: url.searchParams.get('vsn') ?? '1.0.0' } })
        if (ok) return undefined
        return new Response('upgrade failed', { status: 400 })
      }
      return backend.fetch(req)
    },
    websocket: {
      open(ws: { data: WsData; send(d: string | Uint8Array): void; close(c?: number, r?: string): void }) {
        const session = backend.realtime.connect(
          {
            send: (data) => ws.send(data),
            close: (code, reason) => ws.close(code, reason),
          },
          { vsn: ws.data.vsn }
        )
        ws.data.session = session
      },
      message(ws: { data: WsData }, message: string | Uint8Array) {
        ws.data.session?.onMessage(typeof message === 'string' ? message : new Uint8Array(message))
      },
      close(ws: { data: WsData }) {
        ws.data.session?.onClose()
      },
    },
  })

  return {
    server: server as never,
    port: server.port,
    url: `http://${host}:${server.port}`,
    close: async () => {
      server.stop(true)
    },
  }
}
