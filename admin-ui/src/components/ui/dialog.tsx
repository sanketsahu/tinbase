import * as RadixDialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { AlertTriangle, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './button'

/** Centered dialog — generic container for forms and custom content. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
  width,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  wide?: boolean
  /** width classes overriding the presets, e.g. `w-235` for diff layouts */
  width?: string
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-[fade-in_.15s_ease-out]" />
        <RadixDialog.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-input bg-popover shadow-2xl',
            'max-h-[85vh] max-w-[92vw] overflow-auto focus:outline-none',
            width ?? (wide ? 'w-160' : 'w-110')
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <RadixDialog.Title className="text-sm font-semibold">{title}</RadixDialog.Title>
            <RadixDialog.Close className="text-muted-foreground/80 hover:text-foreground">
              <X size={16} />
            </RadixDialog.Close>
          </div>
          <div className="p-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/**
 * Declarative confirmation dialog built on {@link Dialog}. Callers hold the open state.
 *
 * @example
 * {dropping && (
 *   <ConfirmDialog open danger title="Drop policy?" confirmLabel="Drop"
 *     onConfirm={() => void doDrop(dropping)} onClose={() => setDropping(null)} />
 * )}
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** red confirm button for destructive actions */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3">
        {danger && (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15">
            <AlertTriangle size={15} className="text-destructive" />
          </div>
        )}
        <p className="min-w-0 text-[13px] leading-relaxed text-muted-foreground">{description ?? 'Are you sure?'}</p>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? 'dangerSolid' : 'default'}
          autoFocus
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
