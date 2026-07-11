import { Diamond, KeyRound, LayoutGrid, Minus, Plus, Search, Table2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type TableInfo } from '../../api'
import { Button, Empty, Spinner } from '../../components/ui'
import { navigate } from '../../lib/router'
import { SchemaSelect, useDbSchema } from './shared'

/* ── geometry ── */

const NODE_W = 240
const HEADER_H = 32
const ROW_H = 22
const COL_GAP = 110
const ROW_GAP = 36
const PAD = 60

const nodeHeight = (t: TableInfo) => HEADER_H + t.columns.length * ROW_H + 6

interface Pos {
  x: number
  y: number
}

/**
 * Layered auto-layout: tables a table references (FK targets) sit to its
 * left, so data flows parent → child left to right. Cycle-safe.
 */
function autoLayout(tables: TableInfo[]): Record<string, Pos> {
  const byName = new Map(tables.map((t) => [t.name, t]))
  const depthMemo = new Map<string, number>()

  function depth(name: string, stack: Set<string>): number {
    if (depthMemo.has(name)) return depthMemo.get(name)!
    if (stack.has(name)) return 0 // FK cycle — break it
    const t = byName.get(name)
    if (!t) return 0
    stack.add(name)
    let d = 0
    for (const fk of t.foreignKeys) {
      const target = fk.target.split('.').pop()!
      if (target === name || !byName.has(target)) continue
      d = Math.max(d, depth(target, stack) + 1)
    }
    stack.delete(name)
    depthMemo.set(name, d)
    return d
  }

  const layers = new Map<number, TableInfo[]>()
  for (const t of tables) {
    const d = depth(t.name, new Set())
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d)!.push(t)
  }

  const pos: Record<string, Pos> = {}
  for (const [d, layer] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    // biggest tables first inside a layer keeps edge crossings low-ish
    layer.sort((a, b) => b.columns.length - a.columns.length)
    let y = PAD
    for (const t of layer) {
      pos[t.name] = { x: PAD + d * (NODE_W + COL_GAP), y }
      y += nodeHeight(t) + ROW_GAP
    }
  }
  return pos
}

/* ── page ── */

/**
 * Schema Visualizer: an entity-relationship view of the selected schema.
 * Auto-layout by FK depth, draggable tables, pan (drag background) and
 * zoom (wheel / buttons), FK edges drawn column → target table, click a
 * table header to open it in the table editor.
 */
export function VisualizerSection() {
  const [schema] = useDbSchema()
  const [tables, setTables] = useState<TableInfo[] | null>(null)
  const [pos, setPos] = useState<Record<string, Pos>>({})
  const [pan, setPan] = useState<Pos>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState<string | null>(null)

  const drag = useRef<
    | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
    | { kind: 'node'; name: string; startX: number; startY: number; nodeX: number; nodeY: number }
    | null
  >(null)

  const load = useCallback(() => {
    setTables(null)
    api.tables(schema).then(
      (t) => {
        setTables(t)
        setPos(autoLayout(t))
        setPan({ x: 0, y: 0 })
        setZoom(t.length > 8 ? 0.8 : 1)
      },
      () => setTables([])
    )
  }, [schema])

  useEffect(() => {
    load()
  }, [load])

  /* live refresh — table list can change under us (DDL from SQL editor) */
  useEffect(() => {
    const t = setInterval(() => {
      api.tables(schema).then((next) => {
        setTables((cur) => {
          if (!cur) return cur
          const changed = JSON.stringify(next.map((x) => [x.name, x.columns.length])) !== JSON.stringify(cur.map((x) => [x.name, x.columns.length]))
          if (!changed) return cur
          setPos((p) => {
            const merged = { ...autoLayout(next), ...p }
            for (const k of Object.keys(merged)) if (!next.some((x) => x.name === k)) delete merged[k]
            return merged
          })
          return next
        })
      }, () => {})
    }, 5000)
    return () => clearInterval(t)
  }, [schema])

  const edges = useMemo(() => {
    if (!tables) return []
    const byName = new Map(tables.map((t) => [t.name, t]))
    const out: { from: Pos; to: Pos; key: string }[] = []
    for (const t of tables) {
      const p = pos[t.name]
      if (!p) continue
      for (const [fi, fk] of t.foreignKeys.entries()) {
        const targetName = fk.target.split('.').pop()!
        const target = byName.get(targetName)
        const tp = target && pos[targetName]
        if (!target || !tp) continue
        const colIdx = Math.max(0, t.columns.findIndex((c) => c.name === fk.columns[0]))
        const fromY = p.y + HEADER_H + colIdx * ROW_H + ROW_H / 2
        // leave from whichever side faces the target
        const leftward = tp.x + NODE_W / 2 < p.x + NODE_W / 2
        const from = { x: leftward ? p.x : p.x + NODE_W, y: fromY }
        const to = { x: leftward ? tp.x + NODE_W : tp.x, y: tp.y + HEADER_H / 2 }
        out.push({ from, to, key: `${t.name}-${fi}` })
      }
    }
    return out
  }, [tables, pos])

  /* pointer handlers (pan + node drag share one move/up pair) */
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    if (d.kind === 'pan') {
      setPan({ x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) })
    } else {
      const name = d.name
      setPos((p) => ({
        ...p,
        [name]: { x: d.nodeX + (e.clientX - d.startX) / zoom, y: d.nodeY + (e.clientY - d.startY) / zoom },
      }))
    }
  }
  const endDrag = () => (drag.current = null)

  function zoomBy(f: number) {
    setZoom((z) => Math.min(1.6, Math.max(0.3, Math.round(z * f * 100) / 100)))
  }

  function focusTable(name: string) {
    const p = pos[name]
    if (!p) return
    setHighlight(name)
    // center it (viewport ≈ the flex-1 area; a rough center is fine)
    setPan({ x: -(p.x + NODE_W / 2) * zoom + 480, y: -(p.y + 60) * zoom + 240 })
    setTimeout(() => setHighlight((h) => (h === name ? null : h)), 1600)
  }

  const matches = query && tables ? tables.filter((t) => t.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8) : []

  if (tables === null) return <Spinner />

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold text-foreground">Schema Visualizer</h1>
        <SchemaSelect />
        <div className="relative w-56">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find table…"
            className="h-8 w-full rounded-md border border-input bg-field pl-8 pr-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
          />
          {matches.length > 0 && (
            <div className="absolute left-0 top-full z-30 mt-1 w-full overflow-hidden rounded-md border border-input bg-popover py-1 shadow-xl">
              {matches.map((t) => (
                <button
                  key={t.name}
                  className="block w-full px-3 py-1.5 text-left font-mono text-xs text-foreground hover:bg-accent"
                  onClick={() => {
                    focusTable(t.name)
                    setQuery('')
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="ghost" size="iconXs" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
            <Minus size={13} />
          </Button>
          <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="iconXs" title="Zoom in" onClick={() => zoomBy(1.2)}>
            <Plus size={13} />
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              setPos(autoLayout(tables))
              setPan({ x: 0, y: 0 })
            }}
          >
            <LayoutGrid size={12} /> Auto layout
          </Button>
        </div>
      </div>

      {/* canvas */}
      {tables.length === 0 ? (
        <Empty>No tables in this schema yet — create one in the table editor or SQL editor.</Empty>
      ) : (
        <div
          className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-background active:cursor-grabbing"
          style={{
            backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) return
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y }
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerLeave={endDrag}
          onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)}
        >
          <div className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
            {/* edges */}
            <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1}>
              {edges.map((e) => {
                const dx = Math.max(40, Math.abs(e.to.x - e.from.x) / 2)
                const c1 = e.from.x < e.to.x ? e.from.x + dx : e.from.x - dx
                const c2 = e.from.x < e.to.x ? e.to.x - dx : e.to.x + dx
                return (
                  <g key={e.key}>
                    <path
                      d={`M ${e.from.x} ${e.from.y} C ${c1} ${e.from.y}, ${c2} ${e.to.y}, ${e.to.x} ${e.to.y}`}
                      fill="none"
                      stroke="var(--color-muted-foreground)"
                      strokeOpacity={0.45}
                      strokeWidth={1.25}
                    />
                    <circle cx={e.from.x} cy={e.from.y} r={2.5} fill="var(--color-muted-foreground)" fillOpacity={0.7} />
                    <circle cx={e.to.x} cy={e.to.y} r={2.5} fill="var(--color-muted-foreground)" fillOpacity={0.7} />
                  </g>
                )
              })}
            </svg>

            {/* nodes */}
            {tables.map((t) => {
              const p = pos[t.name]
              if (!p) return null
              return (
                <div
                  key={t.name}
                  className={
                    'pointer-events-auto absolute select-none overflow-hidden rounded-md border bg-card shadow-sm transition-shadow ' +
                    (highlight === t.name ? 'border-brand ring-2 ring-brand/40' : 'border-border hover:border-muted-foreground/60')
                  }
                  style={{ left: p.x, top: p.y, width: NODE_W }}
                >
                  <div
                    className="flex h-8 cursor-move items-center gap-1.5 border-b border-border bg-accent/40 px-2.5"
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                      drag.current = { kind: 'node', name: t.name, startX: e.clientX, startY: e.clientY, nodeX: p.x, nodeY: p.y }
                    }}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                  >
                    <Table2 size={12} className="shrink-0 text-muted-foreground" />
                    <button
                      className="min-w-0 flex-1 truncate text-left font-mono text-xs font-medium text-foreground hover:text-brand"
                      title="Open in table editor"
                      onClick={() => navigate('table', t.name)}
                    >
                      {t.name}
                    </button>
                    <span className="text-[10px] tabular-nums text-muted-foreground/60">{t.rowCount.toLocaleString()}</span>
                  </div>
                  <div className="py-0.5">
                    {t.columns.map((c) => (
                      <div key={c.name} className="flex items-center gap-1.5 px-2.5" style={{ height: ROW_H }}>
                        {c.isPrimaryKey ? (
                          <KeyRound size={9} className="shrink-0 text-warning" />
                        ) : (
                          <Diamond size={8} className={'shrink-0 ' + (c.nullable ? 'text-muted-foreground/50' : 'fill-muted-foreground/60 text-muted-foreground/60')} />
                        )}
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/85">{c.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">{c.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* legend */}
          <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-center gap-5 border-t border-border bg-background/80 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur">
            <span className="flex items-center gap-1.5">
              <KeyRound size={10} className="text-warning" /> Primary key
            </span>
            <span className="flex items-center gap-1.5">
              <Diamond size={9} className="text-muted-foreground/50" /> Nullable
            </span>
            <span className="flex items-center gap-1.5">
              <Diamond size={9} className="fill-muted-foreground/60 text-muted-foreground/60" /> Non-nullable
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
