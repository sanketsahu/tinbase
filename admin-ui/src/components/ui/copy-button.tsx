import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { copyText } from '../../lib/clipboard'
import { Button, type ButtonSize, type ButtonVariant } from './button'

/**
 * Copy-with-feedback: after a successful copy the icon flips to a green
 * checkmark for a couple of seconds. `value` may be lazy for click-time
 * serialization (e.g. selected rows → JSON).
 */
export function useCopy(value: string | (() => string), label?: string) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = () => {
    const v = typeof value === 'function' ? value() : value
    void copyText(v, label).then((ok) => {
      if (!ok) return
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1800)
    })
  }
  return { copied, copy }
}

/** Icon button that copies `value` to the clipboard with a transient copied state. */
export function CopyButton({
  value,
  label = 'Value',
  variant = 'ghost',
  size = 'iconXs',
  iconSize = 12,
  className,
  disabled,
  children,
}: {
  value: string | (() => string)
  label?: string
  variant?: ButtonVariant
  size?: ButtonSize
  iconSize?: number
  className?: string
  disabled?: boolean
  /** optional text next to the icon (e.g. "Copy JSON") */
  children?: ReactNode
}) {
  const { copied, copy } = useCopy(value, label)
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={disabled}
      title={copied ? 'Copied!' : `Copy ${label}`}
      onClick={copy}
    >
      {copied ? <Check size={iconSize} className="text-brand" /> : <Copy size={iconSize} />}
      {children}
    </Button>
  )
}
