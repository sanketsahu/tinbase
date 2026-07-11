import { useState } from 'react'
import { api } from '../../api'
import { Button, Dialog, Input, Label, toast } from '../../components/ui'
import { qualify } from '../../lib/schema'

/**
 * Dialog for renaming a column via `alter table … rename column`.
 *
 * @param props.table - Name of the table containing the column.
 * @param props.column - Current name of the column to rename.
 * @param props.onClose - Called to dismiss the dialog (also used when the name
 *   is unchanged).
 * @param props.onDone - Called after a successful rename.
 */
export function RenameColumnDialog({
  table,
  schema = 'public',
  column,
  onClose,
  onDone,
}: {
  table: string
  schema?: string
  column: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const [name, setName] = useState(column)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const to = name.trim()
    if (!to || to === column) return onClose()
    setBusy(true)
    const res = await api.sql(`alter table ${qualify(schema, table)} rename column "${column}" to "${to.replace(/"/g, '""')}"`)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Rename failed')
      return
    }
    toast.success(`Renamed ${column} → ${to}`)
    await onDone()
  }

  return (
    <Dialog open onClose={onClose} title={`Rename column "${column}"`}>
      <div className="space-y-3">
        <div>
          <Label>New name</Label>
          <Input mono value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void submit()} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
