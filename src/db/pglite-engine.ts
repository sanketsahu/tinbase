/** PGlite (WASM) engine — imported dynamically so native mode never loads the WASM bundle. */
import type { DbEngine, EngineResults, EngineTx } from './engine.js'

export async function createPgliteEngine(dataDir?: string): Promise<DbEngine> {
  let PGlite
  try {
    ;({ PGlite } = await import('@electric-sql/pglite'))
  } catch {
    throw new Error(
      'the PGlite (wasm) engine is not available in this build — run with --engine native'
    )
  }
  const pg = dataDir ? new PGlite(dataDir) : new PGlite()
  await pg.waitReady

  return {
    async query<T>(sql: string, params?: unknown[]): Promise<EngineResults<T>> {
      const res = await pg.query<T>(sql, params)
      return { rows: res.rows, affectedRows: res.affectedRows }
    },
    async exec(sql: string): Promise<void> {
      await pg.exec(sql)
    },
    transaction<T>(fn: (tx: EngineTx) => Promise<T>): Promise<T> {
      return pg.transaction(async (tx) => {
        return fn({
          async query<R>(sql: string, params?: unknown[]): Promise<EngineResults<R>> {
            const res = await tx.query<R>(sql, params)
            return { rows: res.rows, affectedRows: res.affectedRows }
          },
          async exec(sql: string): Promise<void> {
            await tx.exec(sql)
          },
        })
      }) as Promise<T>
    },
    async listen(channel: string, cb: (payload: string) => void): Promise<() => void> {
      return pg.listen(channel, cb)
    },
    close: () => pg.close(),
  }
}
