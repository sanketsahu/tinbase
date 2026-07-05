import type { RealtimeEngine } from '../realtime/engine.js'

/** The slice of a backend that servers need — keeps bun/node servers decoupled. */
export interface SupaliteBackendShape {
  fetch: (req: Request) => Promise<Response>
  realtime: RealtimeEngine
}
