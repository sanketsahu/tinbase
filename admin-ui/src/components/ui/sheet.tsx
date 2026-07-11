import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/** How long the sheet-out exit animation runs (keep in sync with index.css). */
const EXIT_MS = 200

/**
 * Wrap cancel/done buttons with this so closing routes through the exit
 * animation: `<SheetClose asChild><Button>Cancel</Button></SheetClose>`
 */
export const SheetClose = Dialog.Close

/**
 * Supabase-style right slide-over panel.
 *
 * Consumers unmount the sheet when `onClose` fires, so the dialog is kept
 * mounted (`open=false`) for the duration of the exit animation before the
 * parent is notified.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  actions,
  flush,
  hideHeader,
  width = 'w-[500px]',
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** pinned footer (action buttons) */
  footer?: ReactNode
  /** extra header controls rendered next to the close button */
  actions?: ReactNode
  /** remove body padding — the content manages its own layout edge-to-edge */
  flush?: boolean
  /** no built-in header bar — the content renders its own (title stays for a11y) */
  hideHeader?: boolean
  /** tailwind width class */
  width?: string
}) {
  const [visible, setVisible] = useState(open)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (open) setVisible(true)
    return () => clearTimeout(timer.current)
  }, [open])

  const requestClose = () => {
    if (!visible) return
    setVisible(false)
    timer.current = setTimeout(onClose, EXIT_MS)
  }

  return (
    <Dialog.Root open={open && visible} onOpenChange={(o) => !o && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-[fade-in_.15s_ease-out] data-[state=closed]:animate-[fade-out_.2s_ease-in]" />
        <Dialog.Content
          className={clsx(
            'fixed inset-y-0 right-0 z-50 flex max-w-[92vw] flex-col border-l border-border bg-background shadow-2xl',
            'transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
            'data-[state=open]:animate-[sheet-in_.25s_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[sheet-out_.2s_ease-in]',
            'focus:outline-none',
            width
          )}
        >
          {hideHeader ? (
            <Dialog.Title className="sr-only">{title}</Dialog.Title>
          ) : (
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
              <Dialog.Title className="text-sm font-medium text-foreground">{title}</Dialog.Title>
              <div className="flex items-center gap-1">
                {actions}
                <Dialog.Close className="rounded p-0.5 text-muted-foreground/80 hover:bg-accent hover:text-foreground">
                  <X size={16} />
                </Dialog.Close>
              </div>
            </div>
          )}
          <div className={clsx('min-h-0 flex-1', flush ? 'overflow-hidden' : 'overflow-y-auto px-5 py-4')}>{children}</div>
          {footer && (
            <div className="flex shrink-0 items-center gap-2 border-t border-border bg-card px-5 py-3">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
