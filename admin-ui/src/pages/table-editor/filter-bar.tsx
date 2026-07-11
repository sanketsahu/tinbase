import { Search, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { Column } from '../../api'
import { OP_GROUPS, OPS, type FilterRule, type OpDef } from './model'

let filterId = 1

/**
 * Supabase-style filter bar: type to pick a column → operator → value, each
 * committed filter renders as a removable chip. Plain text + Enter quick-searches
 * across all text columns.
 *
 * @param props.columns - Columns available to filter on.
 * @param props.filters - The current list of committed filter rules.
 * @param props.onChange - Called with the next list whenever filters are added or removed.
 */
export function FilterBar({
  columns,
  filters,
  onChange,
}: {
  columns: Column[]
  filters: FilterRule[]
  onChange: (f: FilterRule[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<{ column?: string; op?: OpDef } | null>(null)
  const [hi, setHi] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const colMatches = columns.filter((c) => c.name.toLowerCase().includes(text.toLowerCase()))
  const hasSearchOption = text.trim().length > 0 && !draft
  const optionCount = (hasSearchOption ? 1 : 0) + colMatches.length

  function commit(rule: Omit<FilterRule, 'id'>) {
    onChange([...filters, { ...rule, id: filterId++ }])
    setDraft(null)
    setText('')
    setOpen(false)
  }

  function pickColumn(name: string) {
    setDraft({ column: name })
    setText('')
    setHi(0)
    inputRef.current?.focus()
  }

  function pickOp(op: OpDef) {
    if (op.noValue) return commit({ column: draft!.column!, op: op.op, value: '' })
    setDraft({ column: draft!.column, op })
    setText('')
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setDraft(null)
      setText('')
      setOpen(false)
      return
    }
    if (draft?.op) {
      if (e.key === 'Enter' && text.trim()) commit({ column: draft.column!, op: draft.op.op, value: text.trim() })
      if (e.key === 'Backspace' && text === '') {
        setDraft({ column: draft.column })
        setOpen(true)
      }
      return
    }
    if (draft?.column) {
      if (e.key === 'Backspace' && text === '') {
        setDraft(null)
        setOpen(true)
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => Math.min(h + 1, optionCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      if (hasSearchOption && hi === 0) commit({ column: '*', op: 'search', value: text.trim() })
      else {
        const col = colMatches[hi - (hasSearchOption ? 1 : 0)]
        if (col) pickColumn(col.name)
      }
    } else if (e.key === 'Backspace' && text === '' && filters.length > 0) {
      onChange(filters.slice(0, -1))
    }
  }

  const placeholder = draft?.op
    ? draft.op.op === 'in'
      ? 'comma,separated,values — Enter to apply'
      : draft.op.op === 'like' || draft.op.op === 'ilike'
        ? '%pattern% — Enter to apply'
        : 'value — Enter to apply'
    : draft?.column
      ? 'pick an operator…'
      : `Filter by ${columns
          .slice(0, 3)
          .map((c) => c.name)
          .join(', ')}… or type to search`

  return (
    <div className="relative min-w-0 flex-1">
      <div
        className="flex min-h-[30px] cursor-text flex-wrap items-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 hover:border-border focus-within:border-input"
        onClick={() => {
          inputRef.current?.focus()
          if (!draft?.op) setOpen(true)
        }}
      >
        <Search size={13} className="shrink-0 text-muted-foreground/60" />
        {filters.map((f) => {
          const op = OPS.find((o) => o.op === f.op)
          return (
            <span
              key={f.id}
              className="flex max-w-[260px] shrink-0 items-center gap-1 rounded border border-input bg-accent/80 py-0.5 pl-1.5 pr-0.5 text-xs"
            >
              {f.column === '*' ? (
                <span className="truncate text-foreground/80">
                  search <span className="text-brand">“{f.value}”</span>
                </span>
              ) : (
                <>
                  <span className="font-mono text-foreground">{f.column}</span>
                  <span className="text-muted-foreground/80">{op?.sym ?? f.op}</span>
                  {!op?.noValue && <span className="truncate text-brand">{f.value}</span>}
                </>
              )}
              <button
                className="rounded p-0.5 text-muted-foreground/80 hover:bg-muted hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(filters.filter((x) => x.id !== f.id))
                }}
              >
                <X size={11} />
              </button>
            </span>
          )
        })}
        {draft?.column && (
          <span className="flex shrink-0 items-center gap-1 rounded border border-brand/40 bg-brand/10 px-1.5 py-0.5 text-xs">
            <span className="font-mono text-foreground">{draft.column}</span>
            {draft.op && <span className="text-brand">{draft.op.sym}</span>}
          </span>
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setHi(0)
            if (!draft?.op) setOpen(true)
          }}
          onFocus={() => !draft?.op && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={filters.length === 0 || draft ? placeholder : 'Add more filters…'}
          className="h-6 min-w-[140px] flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-50 mt-1 max-h-[340px] w-[300px] overflow-auto rounded-md border border-input bg-popover py-1 shadow-xl animate-[fade-in_.1s_ease-out]">
            {!draft?.column ? (
              <>
                {hasSearchOption && (
                  <button
                    className={
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground ' +
                      (hi === 0 ? 'bg-accent' : 'hover:bg-accent')
                    }
                    onClick={() => commit({ column: '*', op: 'search', value: text.trim() })}
                  >
                    <Search size={13} className="text-muted-foreground/80" />
                    Search all text columns for <span className="text-brand">“{text.trim()}”</span>
                  </button>
                )}
                {colMatches.map((c, i) => {
                  const idx = i + (hasSearchOption ? 1 : 0)
                  return (
                    <button
                      key={c.name}
                      className={
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ' +
                        (hi === idx ? 'bg-accent' : 'hover:bg-accent')
                      }
                      onClick={() => pickColumn(c.name)}
                    >
                      <span className="font-mono text-foreground">{c.name}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground/60">{c.type}</span>
                    </button>
                  )
                })}
                {colMatches.length === 0 && !hasSearchOption && <p className="px-3 py-2 text-xs text-muted-foreground/80">No matching column.</p>}
              </>
            ) : (
              OP_GROUPS.map((g) => {
                const ops = OPS.filter((o) => o.group === g && o.label.toLowerCase().includes(text.toLowerCase()))
                if (ops.length === 0) return null
                return (
                  <div key={g}>
                    <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{g}</p>
                    {ops.map((o) => (
                      <button
                        key={o.op}
                        className="flex w-full items-center px-3 py-1.5 text-left text-[13px] text-foreground hover:bg-accent"
                        onClick={() => pickOp(o)}
                      >
                        {o.label}
                        <span className="ml-auto rounded border border-input bg-accent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {o.sym}
                        </span>
                      </button>
                    ))}
                  </div>
                )
              })
            )}
          </div>
        </>
      )}
    </div>
  )
}
