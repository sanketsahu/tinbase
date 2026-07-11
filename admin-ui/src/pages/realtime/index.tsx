import { ArrowDown, ArrowUp, Play, Plus, Radio, Send, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, getKey } from '../../api'
import { Fact, SettingsRow, SettingsSection as SettingsSectionRow, SettingsShell, SubNav } from '../../components/layout'
import { PolicyEditorSheet } from '../../components/policy-editor'
import { policyToDraft } from '../../components/rls'
import { Badge, Button, Checkbox, ConfirmDialog, CopyButton, Empty, Input, Label, Select, Spinner, Time, toast } from '../../components/ui'
import { navigate, useRoute } from '../../lib/router'
import { apiUrl } from '../../lib/snippet'
import { connectRealtime, type RealtimeConnection, type RtMessage, type RtStatus } from './channel'

const SECTIONS = ['inspector', 'policies', 'settings'] as const
type SectionId = (typeof SECTIONS)[number]

/** Realtime: live channel inspector, authorization policies, and settings. */
export function RealtimePage() {
  const { section } = useRoute()
  const active: SectionId = SECTIONS.includes(section as SectionId) ? (section as SectionId) : 'inspector'

  return (
    <div className="flex h-full">
      <SubNav
        title="Realtime"
        active={active}
        onSelect={(id) => navigate('realtime', id)}
        groups={[
          { title: 'Tools', items: [{ id: 'inspector', label: 'Inspector' }] },
          {
            title: 'Configuration',
            items: [
              { id: 'policies', label: 'Policies' },
              { id: 'settings', label: 'Settings' },
            ],
          },
        ]}
      />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {active === 'inspector' && <InspectorSection />}
        {active === 'policies' && <PoliciesSection />}
        {active === 'settings' && <SettingsSection />}
      </div>
    </div>
  )
}

type Kind = 'broadcast' | 'postgres' | 'presence' | 'system'

function kindOf(m: RtMessage): Kind {
  if (m.event === 'broadcast') return 'broadcast'
  if (m.event === 'postgres_changes') return 'postgres'
  if (m.event.startsWith('presence')) return 'presence'
  return 'system'
}

const KIND_BADGE: Record<Kind, 'brand' | 'blue' | 'amber' | 'neutral'> = {
  broadcast: 'brand',
  postgres: 'blue',
  presence: 'amber',
  system: 'neutral',
}

const STATUS_LABEL: Record<RtStatus, { label: string; variant: 'brand' | 'amber' | 'red' | 'neutral' }> = {
  connecting: { label: 'connecting…', variant: 'amber' },
  open: { label: 'connected', variant: 'amber' },
  joined: { label: 'joined', variant: 'brand' },
  closed: { label: 'disconnected', variant: 'neutral' },
  error: { label: 'error', variant: 'red' },
}

/**
 * Realtime inspector: join a channel over the real WebSocket endpoint, watch
 * postgres_changes / broadcast / presence live, and send broadcasts.
 */
function InspectorSection() {
  const [channel, setChannel] = useState('room-1')
  const [roleKind, setRoleKind] = useState<'service_role' | 'anon'>('service_role')
  const [listenChanges, setListenChanges] = useState(true)
  const [table, setTable] = useState('')
  const [status, setStatus] = useState<RtStatus>('closed')
  const [messages, setMessages] = useState<RtMessage[]>([])
  const [filters, setFilters] = useState<Set<Kind>>(new Set())
  const [event, setEvent] = useState('test')
  const [payload, setPayload] = useState('{ "hello": "world" }')
  const connRef = useRef<RealtimeConnection | null>(null)

  const connected = status === 'joined' || status === 'open' || status === 'connecting'

  useEffect(() => () => connRef.current?.close(), [])

  async function join() {
    const token = roleKind === 'anon' ? ((await api.keys()).anonKey ?? getKey()) : getKey()
    setMessages([])
    connRef.current?.close()
    connRef.current = connectRealtime({
      baseUrl: apiUrl(),
      token,
      channel: channel.trim() || 'room-1',
      listenChanges,
      schema: 'public',
      table: table.trim() || undefined,
      onMessage: (m) => setMessages((cur) => [m, ...cur].slice(0, 500)),
      onStatus: setStatus,
    })
  }

  function leave() {
    connRef.current?.close()
    connRef.current = null
  }

  function sendBroadcast() {
    if (!connRef.current || status !== 'joined') return toast.error('Join a channel first')
    let parsed: unknown
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {}
    } catch {
      return toast.error('Payload is not valid JSON')
    }
    connRef.current.sendBroadcast(event.trim() || 'test', parsed)
  }

  const visible = messages.filter((m) => filters.size === 0 || filters.has(kindOf(m)))
  const st = STATUS_LABEL[status]

  return (
    <div className="flex h-full flex-col">
      {/* join bar */}
      <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-border px-4 py-3">
        <div>
          <Label>Channel</Label>
          <Input mono className="w-44" value={channel} disabled={connected} onChange={(e) => setChannel(e.target.value)} />
        </div>
        <div>
          <Label>Join as</Label>
          <Select
            className="w-36"
            value={roleKind}
            disabled={connected}
            onValueChange={(v) => setRoleKind(v as typeof roleKind)}
            options={[
              { value: 'service_role', label: 'service_role' },
              { value: 'anon', label: 'anon' },
            ]}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-[13px] text-foreground/80">
          <Checkbox checked={listenChanges} disabled={connected} onChange={setListenChanges} />
          postgres_changes
        </label>
        {listenChanges && (
          <div>
            <Label>Table (empty = all public)</Label>
            <Input mono className="w-40" value={table} disabled={connected} placeholder="*" onChange={(e) => setTable(e.target.value)} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2 pb-0.5">
          <Badge variant={st.variant}>
            <Radio size={10} /> {st.label}
          </Badge>
          {connected ? (
            <Button variant="outline" size="xs" onClick={leave}>
              <Square size={11} /> Leave
            </Button>
          ) : (
            <Button size="xs" onClick={() => void join()}>
              <Play size={11} /> Join channel
            </Button>
          )}
        </div>
      </div>

      {/* broadcast composer */}
      <div className="flex shrink-0 items-end gap-3 border-b border-border bg-card px-4 py-2.5">
        <div>
          <Label>Broadcast event</Label>
          <Input mono className="w-36" value={event} onChange={(e) => setEvent(e.target.value)} />
        </div>
        <div className="min-w-0 flex-1">
          <Label>Payload (JSON)</Label>
          <Input mono value={payload} onChange={(e) => setPayload(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendBroadcast()} />
        </div>
        <Button size="xs" className="mb-0.5" onClick={sendBroadcast} disabled={status !== 'joined'}>
          <Send size={11} /> Send
        </Button>
      </div>

      {/* filter chips */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-2">
        {(['broadcast', 'postgres', 'presence', 'system'] as Kind[]).map((k) => (
          <button
            key={k}
            onClick={() =>
              setFilters((cur) => {
                const next = new Set(cur)
                if (next.has(k)) next.delete(k)
                else next.add(k)
                return next
              })
            }
            className={
              'rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ' +
              (filters.size === 0 || filters.has(k)
                ? 'border-input text-foreground/80'
                : 'border-transparent text-muted-foreground/50 hover:text-muted-foreground')
            }
          >
            {k}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground/60">{messages.length} messages</span>
        <Button variant="ghost" size="iconXs" title="Clear feed" onClick={() => setMessages([])}>
          <Trash2 size={13} />
        </Button>
      </div>

      {/* feed */}
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {visible.length === 0 ? (
          <Empty>
            {status === 'joined'
              ? 'Listening… insert a row in the table editor or send a broadcast to see messages.'
              : 'Join a channel to start inspecting realtime traffic.'}
          </Empty>
        ) : (
          visible.map((m, i) => {
            const kind = kindOf(m)
            return (
              <details key={i} className="group rounded px-2 py-1 hover:bg-accent/40">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 text-[12.5px]">
                  {m.dir === 'out' ? (
                    <ArrowUp size={11} className="shrink-0 text-brand" />
                  ) : (
                    <ArrowDown size={11} className="shrink-0 text-info" />
                  )}
                  <span className="shrink-0 font-mono text-muted-foreground/60">
                    <Time value={m.ts} format="time" />
                  </span>
                  <Badge variant={KIND_BADGE[kind]}>{kind}</Badge>
                  <span className="truncate font-mono text-foreground/80">{m.event}</span>
                </summary>
                <pre className="mt-1 overflow-auto rounded-md border border-border bg-code p-2 font-mono text-[11px] text-foreground/80">
                  {JSON.stringify(m.payload, null, 2)}
                </pre>
              </details>
            )
          })
        )}
      </div>
    </div>
  )
}

/* ── authorization policies (realtime.messages) ── */

interface RtPolicy {
  table: string
  name: string
  cmd: string
  permissive: string
  roles: string[] | string
  using_expr: string | null
  with_check: string | null
}

/**
 * Channel authorization: RLS policies on realtime.messages decide who may
 * join private channels, read broadcasts/presence (SELECT) and send them
 * (INSERT) — the same model as Supabase Realtime Authorization.
 */
function PoliciesSection() {
  const [policies, setPolicies] = useState<RtPolicy[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<RtPolicy | null>(null)
  const [dropping, setDropping] = useState<RtPolicy | null>(null)

  const load = useCallback(() => {
    api.policies('realtime').then(
      (p) => setPolicies((p as RtPolicy[]).filter((x) => x.table === 'messages')),
      () => setPolicies([])
    )
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [load])

  if (policies === null) return <Spinner />

  return (
    <div className="mx-auto max-w-3xl px-8 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Policies</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground/80">
            RLS on <code className="text-muted-foreground">realtime.messages</code> authorizes channels: SELECT gates receiving
            broadcast/presence, INSERT gates sending. Use <code className="text-muted-foreground">realtime.topic()</code> in
            expressions to scope a policy to specific channels.
          </p>
        </div>
        <Button size="xs" className="shrink-0" onClick={() => setCreating(true)}>
          <Plus size={12} /> New policy
        </Button>
      </div>

      <div className="mt-6 space-y-2">
        {policies.map((p) => (
          <div
            key={p.name}
            className="cursor-pointer rounded-md border border-border bg-card p-3 transition-colors hover:border-muted-foreground/60"
            title="Edit policy"
            onClick={() => setEditing(p)}
          >
            <div className="flex items-center gap-2">
              <span className="truncate font-mono text-[13px] text-foreground">{p.name}</span>
              <Badge variant="blue">{p.cmd}</Badge>
              <Badge variant="neutral">{Array.isArray(p.roles) ? p.roles.join(', ') : String(p.roles)}</Badge>
              <button
                className="ml-auto p-1 text-muted-foreground/80 hover:text-destructive"
                title="Drop policy"
                onClick={(e) => {
                  e.stopPropagation()
                  setDropping(p)
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {p.using_expr && (
              <p className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground/80" title={p.using_expr}>
                using ({p.using_expr})
              </p>
            )}
            {p.with_check && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80" title={p.with_check}>
                with check ({p.with_check})
              </p>
            )}
          </div>
        ))}
        {policies.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground/60">
            No channel policies yet — every channel is public. Create one to start requiring authorization.
          </p>
        )}
      </div>

      {creating && (
        <PolicyEditorSheet table="messages" schema="realtime" onClose={() => setCreating(false)} onCreated={async () => load()} />
      )}
      {editing && (
        <PolicyEditorSheet
          table="messages"
          schema="realtime"
          existing={policyToDraft(editing)}
          onClose={() => setEditing(null)}
          onCreated={async () => load()}
        />
      )}
      {dropping && (
        <ConfirmDialog
          open
          danger
          title={`Drop policy "${dropping.name}"?`}
          description="Channel authorization changes immediately."
          confirmLabel="Drop policy"
          onConfirm={() => {
            void api.dropPolicy('messages', dropping.name, 'realtime').then(load, (e) => toast.error((e as Error).message))
          }}
          onClose={() => setDropping(null)}
        />
      )}
    </div>
  )
}

/* ── settings / capabilities ── */

function SettingsSection() {
  const ws = `${apiUrl().replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=<anon key>&vsn=1.0.0`
  const Mono = ({ children }: { children: React.ReactNode }) => (
    <code className="rounded bg-code px-1 py-px font-mono text-foreground/90">{children}</code>
  )
  return (
    <SettingsShell title="Realtime Settings">
      <SettingsSectionRow title="Connection" description="How clients reach the Realtime engine.">
        <SettingsRow label="WebSocket endpoint" description="supabase-js connects here automatically from the project URL." wide>
          <div className="flex items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-code px-2.5 py-1.5 font-mono text-[12px] text-foreground/90" title={ws}>
              {ws}
            </code>
            <CopyButton value={ws} label="WebSocket URL" />
          </div>
        </SettingsRow>
        <SettingsRow label="Protocol" description="The exact wire format supabase-js's RealtimeClient speaks.">
          <Fact label="Format" value="Phoenix v1 JSON" />
          <Fact label="Heartbeat" value="every 25s" />
        </SettingsRow>
      </SettingsSectionRow>

      <SettingsSectionRow title="Features" description="What channels can carry on this instance.">
        <SettingsRow label="postgres_changes" description="Change-data-capture on every table — INSERT / UPDATE / DELETE, filterable by schema and table.">
          <Badge variant="brand">Enabled</Badge>
        </SettingsRow>
        <SettingsRow label="Broadcast" description={<>Client-to-client messages; <Mono>self: true</Mono> echoes back to the sender.</>}>
          <Badge variant="brand">Enabled</Badge>
        </SettingsRow>
        <SettingsRow label="Presence" description="Join/leave state tracking per channel.">
          <Badge variant="brand">Enabled</Badge>
        </SettingsRow>
      </SettingsSectionRow>

      <SettingsSectionRow title="Authorization" description="Who may join, read, and send on private channels.">
        <SettingsRow
          label="Channel policies"
          description={<>RLS on <Mono>realtime.messages</Mono>: SELECT gates receiving broadcast/presence, INSERT gates sending. Scope with <Mono>realtime.topic()</Mono>.</>}
        >
          <Button variant="outline" size="xs" onClick={() => navigate('realtime', 'policies')}>
            Manage policies
          </Button>
        </SettingsRow>
      </SettingsSectionRow>
    </SettingsShell>
  )
}
