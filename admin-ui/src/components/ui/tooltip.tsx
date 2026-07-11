import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/** Wraps `children` with a hover tooltip showing `content` on the given `side`. */
export function Tooltip({
  content,
  children,
  side = 'top',
}: {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <RadixTooltip.Provider delayDuration={250}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={5}
            className="z-[60] max-w-[300px] rounded-md border border-input bg-field px-2 py-1 text-xs text-foreground shadow-xl animate-[fade-in_.1s_ease-out]"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}
