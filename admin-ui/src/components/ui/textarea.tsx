import clsx from 'clsx'
import type { TextareaHTMLAttributes } from 'react'

/** Themed monospace textarea. */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={clsx(
        'w-full rounded-md border border-input bg-field p-2.5 font-mono text-[13px] text-foreground',
        'placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
