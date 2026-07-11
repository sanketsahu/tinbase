import clsx from 'clsx'
import type { ReactNode } from 'react'

export type BadgeVariant = 'neutral' | 'brand' | 'amber' | 'red' | 'blue' | 'outline'

/** Small inline pill for status/label text, styled by variant. */
export function Badge({
  variant = 'neutral',
  className,
  children,
}: {
  variant?: BadgeVariant
  className?: string
  children: ReactNode
}) {
  const variants: Record<BadgeVariant, string> = {
    neutral: 'bg-accent text-muted-foreground',
    brand: 'bg-brand/15 text-brand',
    amber: 'bg-warning/15 text-warning',
    red: 'bg-destructive/15 text-destructive',
    blue: 'bg-info/15 text-info',
    outline: 'border border-input text-muted-foreground',
  }
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] leading-none', variants[variant], className)}>
      {children}
    </span>
  )
}
