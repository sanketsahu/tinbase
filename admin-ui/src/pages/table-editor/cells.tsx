import { Check, Clock } from 'lucide-react'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Column } from '../../api'
import { Kbd } from '../../components/ui'
import { nowFor, parseTemporal, type CellAnchor } from './model'

export type { CellAnchor } from './model'

/**
 * Returns a tooltip title for a cell value when its string form is long enough
 * to be worth showing on hover, otherwise `undefined`.
 *
 * @param value - The raw cell value.
 * @returns The stringified value when longer than 40 characters, else `undefined`.
 */
export function cellTitle(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return s.length > 40 ? s : undefined
}

/**
 * Renders a single cell value with type-aware styling (NULL, empty string,
 * boolean, object/JSON, or plain text).
 *
 * @param props.value - The raw cell value to display.
 */
export function Cell({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="select-none text-muted-foreground/60">NULL</span>
  if (value === '') return <span className="select-none italic text-muted-foreground/60">empty</span>
  if (typeof value === 'boolean') return <span className="text-info">{String(value)}</span>
  if (typeof value === 'object') return <span className="text-warning/90">{JSON.stringify(value)}</span>
  return <>{String(value)}</>
}

/* ── helpers ────────────────────────────────────────────────────────────── */

function relative(d: Date): string {
  const diff = d.getTime() - Date.now()
  const abs = Math.abs(diff)
  const units: [number, string][] = [
    [31536000000, 'year'],
    [2592000000, 'month'],
    [86400000, 'day'],
    [3600000, 'hour'],
    [60000, 'minute'],
    [1000, 'second'],
  ]
  for (const [ms, name] of units) {
    if (abs >= ms) {
      const n = Math.round(abs / ms)
      return diff < 0 ? `${n} ${name}${n > 1 ? 's' : ''} ago` : `in ${n} ${name}${n > 1 ? 's' : ''}`
    }
  }
  return 'just now'
}

/**
 * Supabase-style inline editor: a popover anchored to the cell (not typing in
 * the row itself) with type-aware controls and save/cancel affordances.
 *
 * @param props.col - Column metadata driving the control type (bool, temporal, text).
 * @param props.value - The current cell value being edited.
 * @param props.anchor - Viewport rect of the originating cell used to position the popover.
 * @param props.onCommit - Called with the raw string and a move direction (-1 previous, 0 none, 1 next).
 * @param props.onCancel - Called when the edit is dismissed without saving.
 */
export function CellEditor({
  col,
  value,
  anchor,
  enumValues,
  onCommit,
  onCancel,
}: {
  col: Column
  value: unknown
  anchor: CellAnchor
  /** ordered labels when the column's type is an enum — renders a value picker */
  enumValues?: string[]
  onCommit: (raw: string, move: -1 | 0 | 1) => void
  onCancel: () => void
}) {
  const initial =
    value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
  const [raw, setRaw] = useState(initial)
  const done = useRef(false)

  const finish = (fn: () => void) => {
    if (done.current) return
    done.current = true
    fn()
  }
  const save = (move: -1 | 0 | 1 = 0) => finish(() => onCommit(raw, move))
  const cancel = () => finish(onCancel)

  const isBool = col.type === 'bool'
  const isEnum = !isBool && (enumValues?.length ?? 0) > 0
  const isTemporal = /^(timestamp|date|time)/.test(col.type)
  const multiline = !isBool && !isEnum && !isTemporal && !/^(int|float|numeric|uuid)/.test(col.type)

  const hasPreview = /^(timestamp|date)/.test(col.type)
  const parsed = hasPreview && raw ? parseTemporal(raw) : null
  const valid = parsed !== null
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const width = Math.max(anchor.width + 2, isTemporal ? 320 : 280)
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - (multiline ? 320 : isTemporal ? 300 : isEnum ? 320 : 160))) - 1
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 12)) - 1

  /** option list shared by bool + enum columns — click commits immediately */
  const options = isBool ? ['true', 'false', ...(col.nullable ? ['__null'] : [])] : isEnum ? [...enumValues!, ...(col.nullable ? ['__null'] : [])] : null

  return createPortal(
    <div
      style={{ position: 'fixed', top, left, width }}
      className="z-80 overflow-hidden rounded-md border border-muted-foreground bg-card shadow-[0_16px_48px_rgba(0,0,0,0.6)] animate-[fade-in_.1s_ease-out]"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          cancel()
        } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
          e.preventDefault()
          save()
        } else if (e.key === 'Tab') {
          e.preventDefault()
          save(e.shiftKey ? -1 : 1)
        }
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) save()
      }}
    >
      {options ? (
        <div className="max-h-64 overflow-y-auto p-1">
          {options.map((o) => (
            <button
              key={o}
              autoFocus={o === (initial || options[0])}
              onFocus={() => setRaw(o)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => finish(() => onCommit(o, 0))}
              className={
                'flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left font-mono text-[13px] transition-colors hover:bg-accent focus:bg-accent focus:outline-none ' +
                (o === initial ? 'text-brand' : o === '__null' ? 'text-muted-foreground/80' : 'text-foreground')
              }
            >
              {o === '__null' ? 'NULL' : o}
              {o === initial && <Check size={12} className="ml-auto shrink-0" />}
            </button>
          ))}
        </div>
      ) : multiline ? (
        <textarea
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder={col.nullable ? 'NULL' : ''}
          className="block h-52 w-full resize-none bg-transparent px-2.5 py-2 font-mono text-[13px] leading-relaxed text-foreground selection:bg-brand/40 placeholder:text-muted-foreground/60 focus:outline-none"
        />
      ) : (
        <input
          autoFocus
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder={col.nullable ? 'NULL' : ''}
          className="block w-full bg-transparent px-2.5 py-2 font-mono text-[13px] text-foreground selection:bg-brand/40 placeholder:text-muted-foreground/60 focus:outline-none"
        />
      )}

      {hasPreview && (
        <div className="border-t border-border px-2.5 py-2 font-mono text-[11px]">
          <p className="mb-1 font-sans text-muted-foreground/80">Formatted value:</p>
          {raw === '' ? (
            <p className="text-muted-foreground/60">{col.nullable ? 'NULL' : 'empty'}</p>
          ) : valid ? (
            <div className="space-y-0.5">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground/80">UTC</span>
                <span className="text-foreground/80">{parsed.toISOString().replace('T', ' ').slice(0, 19)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="truncate text-muted-foreground/80">{localTz}</span>
                <span className="shrink-0 text-foreground/80">{parsed.toLocaleString()}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground/80">Relative</span>
                <span className="text-foreground/80">{relative(parsed)}</span>
              </div>
            </div>
          ) : (
            <p className="text-destructive">Invalid date</p>
          )}
        </div>
      )}

      <div className="border-t border-border p-1.5">
        <div className="flex items-center gap-1">
          <button
            className="flex flex-1 items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-accent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => save()}
          >
            <Kbd>↵</Kbd> Save changes
          </button>
          {isTemporal && (
            <button
              className="flex shrink-0 items-center gap-1.5 rounded border border-input px-2 py-1 text-xs text-foreground/80 hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setRaw(nowFor(col.type))}
            >
              <Clock size={11} /> Set to NOW
            </button>
          )}
        </div>
        <button
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
        >
          <Kbd>Esc</Kbd> Cancel changes
        </button>
      </div>
    </div>,
    document.body
  )
}
