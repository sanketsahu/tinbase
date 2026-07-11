import clsx from 'clsx'
import { Check, Minus } from 'lucide-react'
import type { MouseEvent } from 'react'

/** Tri-state checkbox (checked / unchecked / indeterminate) rendered as a button. */
export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  title,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange?: (checked: boolean, e: MouseEvent) => void
  disabled?: boolean
  title?: string
  className?: string
}) {
  const on = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onChange?.(!checked, e)
      }}
      className={clsx(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        on ? 'border-brand bg-brand text-primary-foreground' : 'border-muted-foreground bg-transparent hover:border-foreground',
        disabled && 'pointer-events-none opacity-40',
        className
      )}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
    </button>
  )
}
