import type { ReactNode } from 'react'
import { ResizablePanel } from '../ui'

export interface SubNavItem {
  id: string
  label: string
  badge?: ReactNode
}

export interface SubNavGroup {
  /** uppercase group heading (MANAGE / CONFIGURATION …); omit for none */
  title?: string
  items: SubNavItem[]
}

/**
 * Second-level inner sidebar (the 200px panel inside Database, Auth, Storage,
 * Settings, …) with grouped items — one shared look across every section page.
 */
export function SubNav({
  title,
  groups,
  active,
  onSelect,
  footer,
}: {
  title: string
  groups: SubNavGroup[]
  active: string
  onSelect: (id: string) => void
  footer?: ReactNode
}) {
  return (
    <ResizablePanel id="sub-nav" side="left" defaultSize={224} min={176} max={340} className="flex flex-col border-r border-border bg-card">
      <div className="px-4 pb-1 pt-4 text-sm font-semibold text-foreground">{title}</div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((g, gi) => (
          <div key={gi} className="pt-3 first:pt-2">
            {g.title && (
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">{g.title}</p>
            )}
            {g.items.map((it) => (
              <button
                key={it.id}
                onClick={() => onSelect(it.id)}
                className={
                  'mb-px flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ' +
                  (active === it.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')
                }
              >
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.badge}
              </button>
            ))}
          </div>
        ))}
      </nav>
      {footer && <div className="shrink-0 border-t border-border p-3">{footer}</div>}
    </ResizablePanel>
  )
}
