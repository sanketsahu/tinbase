import type { ReactNode } from 'react'

/**
 * The Project-Settings page grammar, shared by every settings-style page
 * (Project Settings, Realtime → Settings, Edge Functions → Settings, …):
 * a page title over full-width divided rows — no card boxes.
 */

/** Page container + underlined title matching Project Settings. */
export function SettingsShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-10 py-8">
      <h1 className="border-b border-border pb-4 text-xl font-semibold text-foreground">{title}</h1>
      {children}
    </div>
  )
}

/** Section heading inside a settings page. */
export function SettingsSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-border pb-2 last:border-0">
      <div className="pb-1 pt-6 first:pt-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground/80">{description}</p>}
      </div>
      <div className="divide-y divide-border/70">{children}</div>
    </div>
  )
}

/**
 * Full-width settings row: label + description on the left, the control on
 * the right, separated from siblings by a divider.
 */
export function SettingsRow({
  label,
  description,
  children,
  wide,
}: {
  label: string
  description?: ReactNode
  children: ReactNode
  /** let the control area use the full remaining width (e.g. theme picker) */
  wide?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-start sm:gap-10">
      <div className="w-64 shrink-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground/80">{description}</p>}
      </div>
      <div className={'min-w-0 flex-1 ' + (wide ? '' : 'max-w-md')}>{children}</div>
    </div>
  )
}

/** Compact fact (label → mono value) for read-only rows. */
export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-foreground/90">{value}</span>
    </div>
  )
}
