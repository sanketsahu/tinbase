/**
 * Builds a DbEngine on top of PgWireClient connections. Shared by the embedded
 * native engine (unix socket, trust auth) and the external `--database-url`
 * engine (TCP, password/SCRAM auth) — only the `connect` function differs.
 */
import type { DbEngine, EngineResults, EngineTx } from '../../db/engine.js'
import { Mutex } from '../../db/engine.js'
import type { PgWireClient } from './wire.js'

export interface WireEngineOptions {
  /** Open a fresh connection to the target (socket or TCP). */
  connect: () => Promise<PgWireClient>
  /** Engine-specific teardown after the connections are closed. */
  onClose?: () => Promise<void> | void
}

export async function buildWireEngine(opts: WireEngineOptions): Promise<DbEngine> {
  const main = await opts.connect()
  const listener = await opts.connect()

  const mutex = new Mutex()
  const listeners = new Map<string, Set<(payload: string) => void>>()
  listener.onNotification = (channel, payload) => {
    for (const cb of listeners.get(channel) ?? []) cb(payload)
  }

  const tx: EngineTx = {
    async query<T>(sql: string, params?: unknown[]): Promise<EngineResults<T>> {
      const res = await main.query<T>(sql, normalizeParams(params))
      return { rows: res.rows, affectedRows: res.affectedRows }
    },
    async exec(sql: string): Promise<void> {
      await main.exec(sql)
    },
  }

  return {
    query<T>(sql: string, params?: unknown[]): Promise<EngineResults<T>> {
      return mutex.run(() => tx.query<T>(sql, params))
    },
    exec(sql: string): Promise<void> {
      return mutex.run(() => tx.exec(sql))
    },
    transaction<T>(fn: (t: EngineTx) => Promise<T>): Promise<T> {
      return mutex.run(async () => {
        await main.exec('begin')
        try {
          const result = await fn(tx)
          await main.exec('commit')
          return result
        } catch (e) {
          await main.exec('rollback').catch(() => {})
          throw e
        }
      })
    },
    async listen(channel: string, cb: (payload: string) => void): Promise<() => void> {
      if (!listeners.has(channel)) {
        listeners.set(channel, new Set())
        await listener.exec(`listen "${channel.replaceAll('"', '""')}"`)
      }
      listeners.get(channel)!.add(cb)
      return () => listeners.get(channel)?.delete(cb)
    },
    async close(): Promise<void> {
      await main.close().catch(() => {})
      await listener.close().catch(() => {})
      await opts.onClose?.()
    },
  }
}

/** Match PGlite's param serialization: arrays → pg literals, objects → JSON. */
export function normalizeParams(params?: unknown[]): unknown[] | undefined {
  return params?.map((p) => {
    if (p === null || p === undefined) return null
    if (Array.isArray(p)) return toPgArrayLiteral(p)
    if (p instanceof Date) return p.toISOString()
    if (typeof p === 'object') return JSON.stringify(p)
    return p
  })
}

function toPgArrayLiteral(arr: unknown[]): string {
  const items = arr.map((el): string => {
    if (el === null || el === undefined) return 'NULL'
    if (Array.isArray(el)) return toPgArrayLiteral(el)
    if (typeof el === 'number' || typeof el === 'boolean') return String(el)
    const s = typeof el === 'object' ? JSON.stringify(el) : String(el)
    return `"${s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  })
  return `{${items.join(',')}}`
}
