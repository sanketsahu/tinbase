import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * Lightweight controlled popover anchored to its trigger (no Radix dependency).
 * Renders trigger inline; when open, a click-away overlay + panel below.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = 'start',
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <div className="relative">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => onOpenChange(false)} />
          <div
            className={clsx(
              'absolute top-full z-50 mt-1 rounded-md border border-input bg-popover shadow-xl animate-[fade-in_.1s_ease-out]',
              align === 'start' ? 'left-0' : 'right-0',
              className
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}
