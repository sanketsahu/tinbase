import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { Toaster as SonnerToaster, toast as sonner } from 'sonner'

export type ToastKind = 'info' | 'success' | 'error'

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
}
const ICON_COLOR: Record<ToastKind, string> = {
  info: 'text-info',
  success: 'text-brand',
  error: 'text-destructive',
}

/**
 * A fully custom toast — full control of the JSX, while Sonner keeps the
 * animations, stacking and swipe-to-dismiss.
 */
function Toast({ id, kind, msg }: { id: string | number; kind: ToastKind; msg: string }) {
  const Icon = ICONS[kind]
  return (
    <div className="group pointer-events-auto relative flex w-[360px] items-start gap-2.5 rounded-md border border-input bg-popover py-2.5 pl-3 pr-8 shadow-xl">
      <Icon size={15} className={`mt-px shrink-0 ${ICON_COLOR[kind]}`} />
      <p className="min-w-0 flex-1 break-words text-[13px] leading-snug text-foreground">{msg}</p>
      <button
        onClick={() => sonner.dismiss(id)}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded text-muted-foreground/80 opacity-0 transition-colors hover:bg-accent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
      >
        <X size={14} />
      </button>
    </div>
  )
}

/** Fire a toast from anywhere (no context needed). */
export function toast(msg: string, kind: ToastKind = 'info') {
  return sonner.custom((id) => <Toast id={id} kind={kind} msg={msg} />, {
    duration: kind === 'error' ? 6000 : 3500,
  })
}
toast.error = (msg: string) => toast(msg, 'error')
toast.success = (msg: string) => toast(msg, 'success')

/** Mount once (in App). */
export function Toaster() {
  return <SonnerToaster position="bottom-right" gap={8} offset={16} />
}
