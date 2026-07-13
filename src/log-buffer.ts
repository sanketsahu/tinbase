/**
 * In-memory ring buffer of recent server log lines, surfaced in the Studio
 * "Logs" pane (and available as backend.logs). Captures request lines and the
 * internal log() output (migrations, mail, webhooks, cron). Dev convenience -
 * bounded, never persisted.
 */
/** Severity derived from response status (or passed explicitly by internal log calls). */
export type LogLevel = 'info' | 'warn' | 'error'

/** One buffered log line. */
export interface LogEntry {
  /** ISO timestamp when pushed. */
  ts: string
  level: LogLevel
  msg: string
}

/** Bounded FIFO of the most recent {@link LogEntry} lines; oldest are dropped past `cap`. */
export class LogBuffer {
  private entries: LogEntry[] = []
  constructor(private cap = 500) {}

  /** Append a line, evicting the oldest once over capacity. */
  push(msg: string, level: LogLevel = 'info'): void {
    this.entries.push({ ts: new Date().toISOString(), level, msg })
    if (this.entries.length > this.cap) this.entries.splice(0, this.entries.length - this.cap)
  }

  /** Most recent first. */
  list(limit = 200): LogEntry[] {
    return this.entries.slice(-limit).reverse()
  }

  /** Drop all buffered lines. */
  clear(): void {
    this.entries = []
  }
}
