/** Underline-style tab strip (Files / Settings / Policies, Results / Chart, …). */
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: string; label: string }[]
  active: string
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex gap-5 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={
            '-mb-px border-b-2 pb-2 text-[13px] transition-colors ' +
            (active === t.id
              ? 'border-foreground font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
