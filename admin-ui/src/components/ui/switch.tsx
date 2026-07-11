import clsx from 'clsx'

/** Toggle switch; invokes `onChange` with the next checked state on click. */
export function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className={clsx(
        'relative h-4.5 w-8 shrink-0 rounded-full transition-colors',
        checked ? 'bg-brand' : 'bg-muted',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <span
        className={clsx(
          'absolute left-0 top-0.5 size-3.5 rounded-full bg-white transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}
