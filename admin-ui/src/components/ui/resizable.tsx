import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Side panel with a draggable resize handle on its inner edge.
 *
 * The size is clamped to [min, max], persisted per `id` in localStorage, and
 * double-clicking the handle snaps back to `defaultSize`. `axis` picks the
 * resized dimension; `side` is where the panel sits in the layout — a left
 * rail (or top pane on axis "y") gets its handle on the far edge, a right
 * rail (or bottom pane) on the near edge.
 */
export function ResizablePanel({
  id,
  axis = 'x',
  side = 'left',
  defaultSize,
  min = 180,
  max = 560,
  className,
  children,
}: {
  /** persistence key — unique per panel (e.g. 'logs-facets') */
  id: string
  /** 'x' resizes width (vertical handle), 'y' resizes height (horizontal handle) */
  axis?: 'x' | 'y'
  /** 'left' = left rail / top pane; 'right' = right rail / bottom pane */
  side?: 'left' | 'right'
  defaultSize: number
  min?: number
  max?: number
  /** the panel's own styling (borders, bg, flex direction) */
  className?: string
  children: ReactNode
}) {
  const key = `tinbase_panel_${id}`
  const [size, setSize] = useState(() => {
    const saved = parseInt(localStorage.getItem(key) ?? '', 10)
    return clamp(Number.isFinite(saved) ? saved : defaultSize, min, max)
  })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const drag = useRef<{ start: number; startSize: number } | null>(null)

  return (
    <div className={clsx('relative shrink-0', className)} style={axis === 'x' ? { width: size } : { height: size }}>
      {children}
      <div
        role="separator"
        aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
        title="Drag to resize — double-click to reset"
        className={clsx(
          'absolute z-20 transition-colors hover:bg-brand/40 active:bg-brand/60',
          axis === 'x'
            ? clsx('inset-y-0 w-1 cursor-col-resize', side === 'left' ? '-right-0.5' : '-left-0.5')
            : clsx('inset-x-0 h-1 cursor-row-resize', side === 'left' ? '-bottom-0.5' : '-top-0.5')
        )}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { start: axis === 'x' ? e.clientX : e.clientY, startSize: sizeRef.current }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const pos = axis === 'x' ? e.clientX : e.clientY
          const delta = side === 'left' ? pos - d.start : d.start - pos
          setSize(clamp(d.startSize + delta, min, max))
        }}
        onPointerUp={() => {
          drag.current = null
          localStorage.setItem(key, String(sizeRef.current))
        }}
        onDoubleClick={() => {
          setSize(clamp(defaultSize, min, max))
          localStorage.setItem(key, String(defaultSize))
        }}
      />
    </div>
  )
}
