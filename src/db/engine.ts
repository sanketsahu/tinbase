/**
 * Database engine abstraction. Two implementations:
 *  - PGlite (WASM Postgres): portable, runs in the browser; heavier RAM.
 *  - Native embedded Postgres (Node only): PocketBase-class footprint.
 * The rest of tinbase only talks to this interface.
 */

/** Result of a query: returned rows plus, for writes, the affected row count. */
export interface EngineResults<T = any> {
  /** result rows, typed as `T` */
  rows: T[]
  /** rows touched by an INSERT/UPDATE/DELETE; undefined for plain SELECTs */
  affectedRows?: number
}

/** Handle passed to a transaction callback; scoped to the open transaction. */
export interface EngineTx {
  /** run a parameterized query within the transaction */
  query<T = any>(sql: string, params?: unknown[]): Promise<EngineResults<T>>
  /** run one or more statements within the transaction (no params) */
  exec(sql: string): Promise<void>
}

/**
 * The single database interface the rest of tinbase talks to, regardless of
 * whether it's backed by PGlite, native embedded Postgres, or the pg-mem subset.
 */
export interface DbEngine {
  /** true for subset engines (pg-mem) that can't run the full plpgsql/RLS bootstrap */
  minimalBootstrap?: boolean
  /** run a parameterized query */
  query<T = any>(sql: string, params?: unknown[]): Promise<EngineResults<T>>
  /** run multiple SQL statements (no params) */
  exec(sql: string): Promise<void>
  /** serialized transaction; implementations must guarantee mutual exclusion */
  transaction<T>(fn: (tx: EngineTx) => Promise<T>): Promise<T>
  /** subscribe to pg_notify on a channel; returns an unsubscribe function */
  listen(channel: string, cb: (payload: string) => void): Promise<() => void>
  /** close the underlying connection/instance */
  close(): Promise<void>
}

/** Simple async mutex for engines that serialize over one connection. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  /** Acquire the lock; await the returned release fn's turn, then call it to free it. */
  async lock(): Promise<() => void> {
    let release!: () => void
    const next = new Promise<void>((r) => (release = r))
    const prev = this.tail
    this.tail = this.tail.then(() => next)
    await prev
    return release
  }

  /** Run `fn` while holding the lock; releases even if `fn` throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.lock()
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
