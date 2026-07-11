import { Tooltip } from './tooltip'

/** Format helpers — locale-aware, 24h, compact ("11 Jul 26 15:31:26"). */
const two = (n: number) => String(n).padStart(2, '0')
const compactDate = (d: Date) =>
  d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
const compactTime = (d: Date) => `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
const compactUtc = (d: Date) => {
  const i = d.toISOString()
  return `${i.slice(8, 10)} ${d.toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })} ${i.slice(2, 4)} ${i.slice(11, 19)}`
}

function relative(d: Date): string {
  const diff = d.getTime() - Date.now()
  const abs = Math.abs(diff)
  if (abs < 10_000) return 'a few seconds ago'
  const units: [number, string][] = [
    [31536000000, 'year'],
    [2592000000, 'month'],
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second'],
  ]
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      return diff < 0 ? `${n} ${name}${n > 1 ? 's' : ''} ago` : `in ${n} ${name}${n > 1 ? 's' : ''}`
    }
  }
  return 'just now'
}

function LeaderRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[11px]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-4 flex-1 border-b border-dotted border-muted-foreground/30" />
      <span className="shrink-0 tabular-nums text-foreground/90">{value}</span>
    </div>
  )
}

/**
 * Timestamp with a hover breakdown — the ONE way the studio renders time.
 * Shows a compact local value; hovering reveals UTC, the local zone, a
 * relative phrase, and the epoch millis. The tooltip auto-flips at viewport
 * edges, so it works in tables, rails, and detail panels alike.
 *
 * @param props.value - ISO string, epoch millis, or Date; nullish renders "—".
 * @param props.format - Which compact form to display inline.
 */
export function Time({
  value,
  format = 'datetime',
  className = '',
}: {
  value: string | number | Date | null | undefined
  format?: 'datetime' | 'date' | 'time' | 'relative'
  className?: string
}) {
  if (value === null || value === undefined || value === '') return <span className={className}>—</span>
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return <span className={className}>{String(value)}</span>

  const display =
    format === 'time'
      ? compactTime(d)
      : format === 'date'
        ? compactDate(d)
        : format === 'relative'
          ? relative(d)
          : `${compactDate(d)} ${compactTime(d)}`

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return (
    <Tooltip
      side="top"
      content={
        <div className="w-72 space-y-1 p-1">
          <LeaderRow label="UTC" value={compactUtc(d)} />
          <LeaderRow label={tz} value={`${compactDate(d)} ${compactTime(d)}`} />
          <LeaderRow label="Relative" value={relative(d)} />
          <LeaderRow label="Timestamp" value={d.getTime()} />
        </div>
      }
    >
      <span
        className={
          'cursor-default whitespace-nowrap tabular-nums underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 ' +
          className
        }
      >
        {display}
      </span>
    </Tooltip>
  )
}
