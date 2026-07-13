/** Backend shape shared by the node:http and Bun servers, keeping each decoupled from the full backend. */
import type { RealtimeEngine } from '../realtime/engine.js'

/** The slice of a backend that servers need - keeps bun/node servers decoupled. */
export interface SupaliteBackendShape {
  /** HTTP request handler; the server forwards every non-upgrade request here */
  fetch: (req: Request) => Promise<Response>
  /** realtime engine the server hands accepted websocket connections to */
  realtime: RealtimeEngine
}
