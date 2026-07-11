/**
 * Renders an arbitrary database value with the studio's canonical colors:
 * NULL/empty muted, booleans info-blue, objects warning-amber JSON.
 */
export function ValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="select-none text-muted-foreground/60">NULL</span>
  if (value === '') return <span className="select-none italic text-muted-foreground/60">empty</span>
  if (typeof value === 'boolean') return <span className="text-info">{String(value)}</span>
  if (typeof value === 'object') return <span className="text-warning/90">{JSON.stringify(value)}</span>
  return <>{String(value)}</>
}

/** tooltip text for long values (undefined when short) */
export function valueTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return s.length > 40 ? s : undefined
}
