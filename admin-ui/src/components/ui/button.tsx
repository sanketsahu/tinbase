import clsx from 'clsx'
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'default' | 'outline' | 'ghost' | 'danger' | 'dangerSolid'
export type ButtonSize = 'sm' | 'xs' | 'icon' | 'iconXs'

/** Button styled by variant and size; forwards native button props. */
export function Button({
  variant = 'default',
  size = 'sm',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const variants: Record<ButtonVariant, string> = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90 font-medium',
    outline: 'border border-input text-foreground hover:bg-accent hover:border-muted-foreground',
    ghost: 'text-foreground/80 hover:bg-accent',
    danger: 'border border-destructive/30 text-destructive hover:bg-destructive/10',
    dangerSolid: 'bg-destructive text-primary-foreground hover:bg-destructive/90 font-medium',
  }
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-[13px]',
    xs: 'h-6 px-2 text-xs',
    icon: 'size-8',
    iconXs: 'size-6',
  }
  return (
    <button
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none',
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
