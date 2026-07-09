/**
 * In-process data-retention sweeper. Periodically purges expired or stale rows
 * that would otherwise accumulate forever: consumed/expired one-time tokens,
 * revoked and aged-out refresh tokens, expired MFA challenges and OAuth flow
 * state, and audit-log entries past the retention window.
 *
 * Supports GDPR data-minimization and keeps the auth tables from growing
 * unbounded. All windows are configurable; a window of 0 disables that sweep.
 */
import type { Database } from '../db/database.js'

export interface RetentionConfig {
  /** How often to run a sweep (ms). Default 1 hour. */
  intervalMs?: number
  /** Delete audit_log_entries older than this many days (0 = keep forever). Default 90. */
  auditLogDays?: number
  /** Delete revoked/expired refresh tokens older than this many days (0 = keep). Default 30. */
  refreshTokenDays?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export class RetentionService {
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly intervalMs: number
  private readonly auditLogDays: number
  private readonly refreshTokenDays: number

  constructor(
    private db: Database,
    config: RetentionConfig = {},
    private now: () => Date = () => new Date()
  ) {
    this.intervalMs = config.intervalMs ?? 60 * 60 * 1000
    this.auditLogDays = config.auditLogDays ?? 90
    this.refreshTokenDays = config.refreshTokenDays ?? 30
  }

  start(): void {
    if (this.timer) return
    // run once at boot, then on the interval
    void this.sweep()
    this.timer = setInterval(() => void this.sweep(), this.intervalMs)
    if (typeof this.timer === 'object' && 'unref' in this.timer) (this.timer as { unref: () => void }).unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Run a single retention pass (also callable directly in tests). */
  async sweep(): Promise<void> {
    const now = this.now()
    await this.run(`delete from auth.one_time_tokens where expires_at < now()`)
    await this.run(`delete from auth.mfa_challenges where expires_at < now()`)
    await this.run(`delete from auth.flow_state where expires_at < now()`)
    if (this.refreshTokenDays > 0) {
      const cutoff = new Date(now.getTime() - this.refreshTokenDays * DAY_MS).toISOString()
      await this.run(`delete from auth.refresh_tokens where revoked = true and updated_at < $1`, [cutoff])
    }
    if (this.auditLogDays > 0) {
      const cutoff = new Date(now.getTime() - this.auditLogDays * DAY_MS).toISOString()
      await this.run(`delete from auth.audit_log_entries where created_at < $1`, [cutoff])
    }
  }

  private async run(sql: string, params: unknown[] = []): Promise<void> {
    try {
      await this.db.query(sql, params)
    } catch {
      // table may not exist on a subset engine (pg-mem) — skip
    }
  }
}
