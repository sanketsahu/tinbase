import type { ReactNode } from 'react'

/** Renders its children as a styled keyboard-key badge. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-input bg-accent px-1 font-mono text-[10px] text-muted-foreground">
      {children}
    </kbd>
  )
}
