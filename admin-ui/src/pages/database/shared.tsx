import { RefreshCw, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { SchemaSelect } from '../../components/schema-select'
import { Button } from '../../components/ui'

export { useDbSchema, setDbSchema } from '../../lib/schema'
export { SchemaSelect } from '../../components/schema-select'

/** Standard header for a database catalog page: title, blurb, schema, search, actions. */
export function CatalogHeader({
  title,
  description,
  search,
  onSearch,
  onRefresh,
  actions,
  schemaPicker,
  filters,
}: {
  title: string
  description: string
  search?: string
  onSearch?: (v: string) => void
  onRefresh?: () => void
  actions?: ReactNode
  /** show the shared schema dropdown on the filter row */
  schemaPicker?: boolean
  /** extra filter controls rendered next to the search input */
  filters?: ReactNode
}) {
  return (
    <div className="border-b border-border px-6 pb-4 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{title}</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground/80">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-1">
          {onRefresh && (
            <Button variant="ghost" size="iconXs" title="Refresh" onClick={onRefresh}>
              <RefreshCw size={13} />
            </Button>
          )}
          {actions}
        </div>
      </div>
      {(onSearch || schemaPicker || filters) && (
        <div className="mt-3 flex items-center gap-2">
          {schemaPicker && <SchemaSelect />}
          {onSearch && (
            <div className="relative w-full max-w-xs">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 w-full rounded-md border border-input bg-field pl-8 pr-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
              />
            </div>
          )}
          {filters}
        </div>
      )}
    </div>
  )
}

/** Escape an identifier for interpolation into DDL. */
export const quoteIdent = (s: string) => '"' + s.replace(/"/g, '""') + '"'
/** Escape a string literal for interpolation into SQL. */
export const quoteLit = (s: string) => "'" + s.replace(/'/g, "''") + "'"
