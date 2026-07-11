import type { ReactNode } from 'react'

/** Styled form field label. */
export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-muted-foreground">{children}</label>
}
