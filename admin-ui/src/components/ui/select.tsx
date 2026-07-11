import * as RadixSelect from '@radix-ui/react-select'
import clsx from 'clsx'
import { Check, ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SelectOption {
  value: string
  /** defaults to the value itself */
  label?: ReactNode
  disabled?: boolean
}

const EMPTY = '__select-empty__'
const toRadix = (v: string) => (v === '' ? EMPTY : v)
const fromRadix = (v: string) => (v === EMPTY ? '' : v)

/**
 * Fully themed dropdown built on Radix — no native OS select menu.
 *
 * Radix reserves the empty string, so an empty `value` is mapped through an
 * internal sentinel, letting callers keep using `''` for "default / unset".
 */
export function Select({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled,
  autoFocus,
  mono,
  size = 'sm',
  className = 'w-full',
}: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: ReactNode
  disabled?: boolean
  autoFocus?: boolean
  mono?: boolean
  /** `sm` (h-8, default) for forms; `xs` (h-6) to sit flush next to xs buttons in toolbars. */
  size?: 'sm' | 'xs'
  /** Sizing classes for the trigger — defaults to `w-full`; pass e.g. `w-36 shrink-0` for toolbar use. */
  className?: string
}) {
  return (
    <RadixSelect.Root value={toRadix(value)} onValueChange={(v) => onValueChange(fromRadix(v))} disabled={disabled}>
      <RadixSelect.Trigger
        autoFocus={autoFocus}
        className={clsx(
          'flex cursor-pointer items-center gap-1.5 rounded-md border border-input bg-field text-left text-foreground',
          size === 'xs' ? 'h-6 px-2 text-xs' : 'h-8 px-2.5 text-[13px]',
          'transition-colors hover:border-muted-foreground focus:border-brand focus:outline-none disabled:pointer-events-none disabled:opacity-50',
          'data-placeholder:text-muted-foreground/60',
          mono && 'font-mono',
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown size={13} className="shrink-0 text-muted-foreground/80" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-90 max-h-64 min-w-(--radix-select-trigger-width) overflow-hidden rounded-md border border-input bg-popover shadow-xl animate-[fade-in_.1s_ease-out]"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((o) => (
              <RadixSelect.Item
                key={o.value}
                value={toRadix(o.value)}
                disabled={o.disabled}
                className={clsx(
                  'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] text-foreground outline-none',
                  'data-highlighted:bg-accent data-disabled:pointer-events-none data-disabled:opacity-40',
                  mono && 'font-mono'
                )}
              >
                <span className="min-w-0 flex-1 truncate">
                  <RadixSelect.ItemText>{o.label ?? o.value}</RadixSelect.ItemText>
                </span>
                <RadixSelect.ItemIndicator>
                  <Check size={12} className="shrink-0 text-brand" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}
