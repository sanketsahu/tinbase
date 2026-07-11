import { Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api'
import { Badge, Button, CodeEditor, ConfirmDialog, Empty, Input, Label, Sheet, SheetClose, Spinner, Table, Td, Th, THead, Time, toast, TRow } from '../../components/ui'
import { CatalogHeader, quoteLit } from '../database/shared'

interface Job {
  jobid: number
  jobname: string | null
  schedule: string
  command: string
  active: boolean
}

interface Run {
  jobid: number
  status: string
  return_message: string | null
  start_time: string
  end_time: string | null
}

/** pg_cron-compatible scheduled jobs: list, create, unschedule, run history. */
export function CronSection() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [creating, setCreating] = useState(false)
  const [removing, setRemoving] = useState<Job | null>(null)

  const load = useCallback(async () => {
    const [j, r] = await Promise.all([
      api.sql(`select jobid, jobname, schedule, command, active from cron.job order by jobid`),
      api.sql(`select jobid, status, return_message, start_time, end_time from cron.job_run_details order by start_time desc limit 50`),
    ])
    setJobs(j.ok ? ((j.rows ?? []) as Job[]) : [])
    setRuns(r.ok ? ((r.rows ?? []) as Run[]) : [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function unschedule(job: Job) {
    const res = await api.sql(`select cron.unschedule(${quoteLit(job.jobname ?? String(job.jobid))})`)
    if (!res.ok) {
      toast.error(res.error ?? 'Unschedule failed')
      return
    }
    toast.success(`Unscheduled ${job.jobname ?? job.jobid}`)
    await load()
  }

  if (jobs === null) return <Spinner />

  return (
    <div className="flex h-full flex-col">
      <CatalogHeader
        title="Cron"
        description="Scheduled SQL, pg_cron-compatible — jobs run in UTC with service-role privileges while tinbase is up."
        onRefresh={() => void load()}
        actions={
          <Button size="xs" onClick={() => setCreating(true)}>
            <Plus size={12} /> Schedule job
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Table>
          <THead>
            <tr>
              <Th>Name</Th>
              <Th>Schedule</Th>
              <Th>Command</Th>
              <Th>Status</Th>
              <Th className="w-12" />
            </tr>
          </THead>
          <tbody>
            {jobs.map((j) => (
              <TRow key={j.jobid}>
                <Td className="font-mono text-foreground/90">{j.jobname ?? `#${j.jobid}`}</Td>
                <Td className="font-mono text-brand">{j.schedule}</Td>
                <Td className="max-w-90 truncate font-mono text-[11px] text-muted-foreground/80" title={j.command}>
                  {j.command}
                </Td>
                <Td>{j.active ? <Badge variant="brand">active</Badge> : <Badge variant="neutral">inactive</Badge>}</Td>
                <Td>
                  <button
                    className="p-1 text-muted-foreground/80 opacity-0 hover:text-destructive group-hover:opacity-100"
                    title="Unschedule"
                    onClick={() => setRemoving(j)}
                  >
                    <Trash2 size={13} />
                  </button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </Table>
        {jobs.length === 0 && (
          <Empty>
            No jobs scheduled. <code className="text-muted-foreground">select cron.schedule('name', '*/5 * * * *', 'select 1')</code>{' '}
            also works from SQL.
          </Empty>
        )}

        {runs.length > 0 && (
          <>
            <h2 className="border-b border-border px-6 pb-2 pt-6 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              Recent runs
            </h2>
            <Table>
              <THead>
                <tr>
                  <Th>Job</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Message</Th>
                </tr>
              </THead>
              <tbody>
                {runs.map((r, i) => (
                  <TRow key={i}>
                    <Td className="font-mono text-muted-foreground">
                      {jobs.find((j) => j.jobid === r.jobid)?.jobname ?? `#${r.jobid}`}
                    </Td>
                    <Td>
                      {r.status === 'succeeded' ? <Badge variant="brand">succeeded</Badge> : <Badge variant="red">{r.status}</Badge>}
                    </Td>
                    <Td className="text-muted-foreground">
                      <Time value={r.start_time} />
                    </Td>
                    <Td className="max-w-90 truncate font-mono text-[11px] text-muted-foreground/80" title={r.return_message ?? ''}>
                      {r.return_message ?? '—'}
                    </Td>
                  </TRow>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>

      {creating && (
        <ScheduleDialog
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          danger
          title={`Unschedule "${removing.jobname ?? removing.jobid}"?`}
          description="The job stops running immediately. Run history is kept."
          confirmLabel="Unschedule"
          onConfirm={() => void unschedule(removing)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  )
}

function ScheduleDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('*/5 * * * *')
  const [command, setCommand] = useState("select net.http_post('https://example.com/hook', '{}'::jsonb)")
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim() || !schedule.trim() || !command.trim()) return setErr('All fields are required.')
    setBusy(true)
    setErr('')
    const res = await api.sql(`select cron.schedule(${quoteLit(name.trim())}, ${quoteLit(schedule.trim())}, ${quoteLit(command)})`)
    if (!res.ok) {
      setErr(res.error ?? 'Schedule failed')
      setBusy(false)
      return
    }
    toast.success(`Scheduled ${name.trim()}`)
    await onDone()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-140"
      title="Schedule a new job"
      footer={
        <>
          {err && <p className="min-w-0 truncate text-xs text-destructive">{err}</p>}
          <div className="ml-auto flex items-center gap-2">
            <SheetClose asChild>
              <Button variant="outline">Cancel</Button>
            </SheetClose>
            <Button onClick={() => void create()} disabled={busy}>
              {busy ? 'Scheduling…' : 'Schedule job'}
            </Button>
          </div>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Name</Label>
            <Input mono value={name} autoFocus placeholder="cleanup" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label>Schedule — cron (UTC) or "N seconds"</Label>
            <Input mono value={schedule} placeholder="*/5 * * * *" onChange={(e) => setSchedule(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>SQL command</Label>
          <CodeEditor lang="sql" className="h-40" value={command} onChange={setCommand} onCmdEnter={() => void create()} />
        </div>
      </div>
    </Sheet>
  )
}
