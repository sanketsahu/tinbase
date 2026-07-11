import * as Dropdown from '@radix-ui/react-dropdown-menu'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

/** Root wrapper for a dropdown menu. */
export const Menu = Dropdown.Root
/** Element that toggles the menu open. */
export const MenuTrigger = Dropdown.Trigger
/** Wrapper for a nested submenu. */
export const MenuSub = Dropdown.Sub

const CONTENT_CLS = 'z-50 min-w-[180px] rounded-md border border-input bg-popover p-1 shadow-xl animate-[fade-in_.1s_ease-out]'

/** Portalled dropdown menu panel that holds menu items. */
export function MenuContent({
  children,
  align = 'start',
  className,
}: {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        align={align}
        sideOffset={4}
        className={clsx(
          'z-50 min-w-[180px] rounded-md border border-input bg-popover p-1 shadow-xl animate-[fade-in_.1s_ease-out]',
          className
        )}
      >
        {children}
      </Dropdown.Content>
    </Dropdown.Portal>
  )
}

/** Selectable menu row, optionally destructive (`danger`) with a trailing shortcut. */
export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  shortcut,
}: {
  children: ReactNode
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  shortcut?: ReactNode
}) {
  return (
    <Dropdown.Item
      disabled={disabled}
      onSelect={onSelect}
      className={clsx(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none',
        danger ? 'text-destructive data-[highlighted]:bg-destructive/10' : 'text-foreground data-[highlighted]:bg-accent',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {children}
      {shortcut !== undefined && <span className="ml-auto pl-4 text-[11px] text-muted-foreground/80">{shortcut}</span>}
    </Dropdown.Item>
  )
}

/** Menu row that opens a nested submenu. */
export function MenuSubTrigger({ children }: { children: ReactNode }) {
  return (
    <Dropdown.SubTrigger className="flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground outline-none data-[highlighted]:bg-accent data-[state=open]:bg-accent">
      {children}
      <ChevronRight size={12} className="ml-auto text-muted-foreground/80" />
    </Dropdown.SubTrigger>
  )
}

/** Portalled panel for a nested submenu's items. */
export function MenuSubContent({ children }: { children: ReactNode }) {
  return (
    <Dropdown.Portal>
      <Dropdown.SubContent sideOffset={6} className={CONTENT_CLS}>
        {children}
      </Dropdown.SubContent>
    </Dropdown.Portal>
  )
}

/** Horizontal divider between groups of menu items. */
export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 h-px bg-accent" />
}

/** Non-interactive uppercase heading for a menu section. */
export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{children}</Dropdown.Label>
}
