import type { ReactNode } from 'react'

/** Centered placeholder shown when a list or view has no content. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-[13px] text-muted-foreground/80">{children}</div>
}
