import { ChevronDown, Globe, KeyRound, Mail, Plus, RefreshCw, Search, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api'
import {
  Badge,
  Button,
  Dialog,
  Empty,
  Input,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Select,
  Spinner,
  Table,
  Td,
  Th,
  THead,
  Time,
  toast,
  TRow,
} from '../../components/ui'
import { UserPanel, type AuthUser } from './user-panel'

const PAGE = 50

function providerOf(u: AuthUser): string {
  return (u.app_metadata?.provider as string) || (u.is_anonymous ? 'anonymous' : 'email')
}

function ProviderIcon({ provider }: { provider: string }) {
  if (provider === 'email') return <Mail size={12} className="text-muted-foreground" />
  if (provider === 'anonymous') return <UserRound size={12} className="text-muted-foreground" />
  return <Globe size={12} className="text-muted-foreground" />
}

/** Users grid: search, provider filter, pagination, detail panel, add/invite. */
export function UsersSection() {
  const [users, setUsers] = useState<AuthUser[] | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'anonymous' | 'verified'>('all')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<AuthUser | null>(null)
  const [creating, setCreating] = useState(false)
  const [inviting, setInviting] = useState(false)

  const load = useCallback(() => {
    api.users().then(
      (u) => setUsers(u as AuthUser[]),
      () => setUsers([])
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    if (!users) return []
    const q = search.toLowerCase().trim()
    return users.filter((u) => {
      if (filter === 'anonymous' && !u.is_anonymous) return false
      if (filter === 'verified' && !u.email_confirmed_at) return false
      if (!q) return true
      return (u.email ?? '').toLowerCase().includes(q) || u.id.toLowerCase().includes(q)
    })
  }, [users, search, filter])

  useEffect(() => setPage(0), [search, filter])

  if (users === null) return <Spinner />

  const pages = Math.max(1, Math.ceil(visible.length / PAGE))
  const slice = visible.slice(page * PAGE, (page + 1) * PAGE)

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <h1 className="text-sm font-semibold text-foreground">Users</h1>
          <Badge variant="neutral">{users.length}</Badge>
          <div className="relative ml-2 w-64">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or UID…"
              className="h-8 w-full rounded-md border border-input bg-field pl-8 pr-2 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-brand focus:outline-none"
            />
          </div>
          <Select
            className="w-36 shrink-0"
            value={filter}
            onValueChange={(v) => setFilter(v as typeof filter)}
            options={[
              { value: 'all', label: 'All users' },
              { value: 'verified', label: 'Verified' },
              { value: 'anonymous', label: 'Anonymous' },
            ]}
          />
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="iconXs" title="Refresh" onClick={load}>
              <RefreshCw size={13} />
            </Button>
            <Menu>
              <MenuTrigger asChild>
                <Button size="xs">
                  <Plus size={12} /> Add user <ChevronDown size={11} />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                <MenuItem onSelect={() => setCreating(true)}>
                  <KeyRound size={13} /> Create with password
                </MenuItem>
                <MenuItem onSelect={() => setInviting(true)}>
                  <Mail size={13} /> Invite via magic link
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>

        {/* grid */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <THead>
              <tr>
                <Th>Email</Th>
                <Th>UID</Th>
                <Th>Provider</Th>
                <Th>Created</Th>
                <Th>Last sign in</Th>
              </tr>
            </THead>
            <tbody>
              {slice.map((u) => {
                const provider = providerOf(u)
                return (
                  <TRow key={u.id} className="cursor-pointer" onClick={() => setSelected(u)}>
                    <Td className="text-foreground/90">
                      <span className="flex items-center gap-2">
                        {u.email || <span className="italic text-muted-foreground/60">{u.is_anonymous ? 'anonymous' : '—'}</span>}
                        {u.is_anonymous && <Badge variant="neutral">anon</Badge>}
                        {u.email && !u.email_confirmed_at && <Badge variant="amber">unverified</Badge>}
                      </span>
                    </Td>
                    <Td className="font-mono text-[11px] text-muted-foreground/80">{u.id.slice(0, 8)}…</Td>
                    <Td>
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <ProviderIcon provider={provider} />
                        {provider}
                      </span>
                    </Td>
                    <Td className="text-muted-foreground">
                      <Time value={u.created_at} format="date" />
                    </Td>
                    <Td className="text-muted-foreground">
                      <Time value={u.last_sign_in_at} />
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </Table>
          {slice.length === 0 && <Empty>{users.length === 0 ? 'No users yet — add one or invite via magic link.' : 'No match.'}</Empty>}
        </div>

        {/* footer */}
        <div className="flex shrink-0 items-center gap-3 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground/80">
          <span>
            {visible.length.toLocaleString()} user{visible.length === 1 ? '' : 's'}
          </span>
          {pages > 1 && (
            <span className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="xs" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              Page {page + 1} of {pages}
              <Button variant="ghost" size="xs" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          )}
        </div>
      </div>

      {/* detail panel */}
      {selected && (
        <UserPanel
          user={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load()
            setSelected(null)
          }}
        />
      )}

      {creating && (
        <CreateUserDialog
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            load()
          }}
        />
      )}
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function CreateUserDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await api.createUser({ email, password: password || undefined, email_confirm: true })
      toast.success(`Created ${email}`)
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Create user">
      <div className="space-y-3">
        <div>
          <Label>Email</Label>
          <Input value={email} autoFocus placeholder="user@example.com" onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label>Password (optional — leave empty for passwordless)</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !email.includes('@')}>
            {busy ? 'Creating…' : 'Create user'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await api.sendMagicLink(email)
      toast.success(`Magic link sent to ${email} — check /inbox in dev`)
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title="Invite via magic link">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground/80">
          Sends a sign-in link (creating the user if needed). Without a configured mailer, the email lands in the local dev inbox
          at <code className="text-muted-foreground">/inbox</code>.
        </p>
        <div>
          <Label>Email</Label>
          <Input value={email} autoFocus placeholder="user@example.com" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && email.includes('@') && void submit()} />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !email.includes('@')}>
            {busy ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
