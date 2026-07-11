import clsx from 'clsx'
import type { InputHTMLAttributes } from 'react'

/** Themed text input; set `mono` to render its value in a monospace font. */
export function Input({ className, mono, ...props }: InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }) {
  return (
    <input
      className={clsx(
        'h-8 w-full rounded-md border border-input bg-field px-2.5 text-[13px] text-foreground',
        'placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none disabled:opacity-50',
        mono && 'font-mono',
        className
      )}
      {...props}
    />
  )
}
