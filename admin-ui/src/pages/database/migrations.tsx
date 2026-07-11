import { Eye } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Button, CodeView, Empty, Sheet, SheetClose, Spinner, Table, Td, Th, THead, Time, TRow } from '../../components/ui'
import { CatalogHeader } from './shared'

interface Migration {
  version: string
  name: string | null
  applied_at: string
  statements?: string[] | string | null
}

/** Applied migrations, with the recorded SQL where available. */
export function MigrationsSection() {
  const [rows, setRows] = useState<Migration[] | null>(null)
  const [viewing, setViewing] = useState<Migration | null>(null)

  const load = useCallback(async () => {
    // read the raw table so we pick up the statements column when it exists
    const res = await api.sql(`select * from supabase_migrations.schema_migrations order by version`)
    if (res.ok) setRows((res.rows ?? []) as Migration[])
    else {
      // fall back to the admin endpoint's shape
      api.migrations().then(
        (m) => setRows(m),
        () => setRows([])
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (rows === null) return <Spinner />

  const sqlOf = (m: Migration): string | null => {
    if (Array.isArray(m.statements)) return m.statements.join('\n\n')
    if (typeof m.statements === 'string' && m.statements.trim()) return m.statements
    return null
  }

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Migrations"
        description="Applied migrations from supabase/migrations/*.sql — the same ledger the Supabase CLI uses."
        onRefresh={() => void load()}
      />
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <THead>
            <tr>
              <Th>Version</Th>
              <Th>Name</Th>
              <Th>Applied</Th>
              <Th className="w-12" />
            </tr>
          </THead>
          <tbody>
            {rows.map((m) => (
              <TRow key={m.version}>
                <Td className="font-mono text-muted-foreground">{m.version}</Td>
                <Td className="font-mono text-foreground/90">{m.name || '—'}</Td>
                <Td className="text-muted-foreground">
                  <Time value={m.applied_at} />
                </Td>
                <Td>
                  {sqlOf(m) && (
                    <button
                      className="p-1 text-muted-foreground/80 opacity-0 hover:text-foreground group-hover:opacity-100"
                      title="View SQL"
                      onClick={() => setViewing(m)}
                    >
                      <Eye size={13} />
                    </button>
                  )}
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && (
          <Empty>
            No migrations applied. Add SQL files under <code className="text-muted-foreground">supabase/migrations/</code> and
            restart.
          </Empty>
        )}
      </div>

      {viewing && (
        <Sheet
          open
          onClose={() => setViewing(null)}
          width="w-[640px]"
          title={
            <span>
              Migration <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-xs text-foreground">{viewing.name ?? viewing.version}</code>
            </span>
          }
          footer={
            <SheetClose asChild>
              <Button variant="outline" className="ml-auto">
                Done
              </Button>
            </SheetClose>
          }
        >
          <CodeView value={sqlOf(viewing) ?? '-- SQL not recorded for this migration'} lang="sql" readOnly gutter minLines={6} maxLines={500} />
        </Sheet>
      )}
    </div>
  )
}
