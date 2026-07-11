import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from './copy-button'
import { Input } from './input'
import { Label } from './label'

/**
 * Read-only credential field: label + hint, masked-by-default when `danger`
 * (secrets), with an eye toggle and a copy button.
 */
export function KeyField({
  label,
  hint,
  value,
  danger,
  bare,
}: {
  label: string
  hint: string
  value: string
  danger?: boolean
  /** skip the built-in label row (when the surrounding layout provides one) */
  bare?: boolean
}) {
  const [visible, setVisible] = useState(!danger)
  return (
    <div>
      {!bare && (
        <Label>
          {label}{' '}
          <span className={'ml-1 font-normal ' + (danger ? 'text-destructive/80' : 'text-muted-foreground/80')}>{hint}</span>
        </Label>
      )}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input mono readOnly type={visible ? 'text' : 'password'} value={value || 'unavailable'} className="pr-9" />
          <button
            type="button"
            title={visible ? 'Hide key' : 'Reveal key'}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/80 transition-colors hover:text-foreground"
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <CopyButton value={value} label={label} variant="outline" size="icon" iconSize={13} disabled={!value} />
      </div>
    </div>
  )
}
