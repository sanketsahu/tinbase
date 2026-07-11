import { KeyRound, Mail, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../../api'
import {
  Badge,
  Button,
  CodeView,
  ConfirmDialog,
  CopyButton,
  Dialog,
  Input,
  Label,
  Sheet,
  SheetClose,
  Tabs,
  Time,
  toast,
} from '../../components/ui'

export interface AuthUser {
  id: string
  email?: string
  created_at?: string
  updated_at?: string
  last_sign_in_at?: string
  email_confirmed_at?: string
  confirmation_sent_at?: string
  is_anonymous?: boolean
  app_metadata?: Record<string, unknown>
  user_metadata?: Record<string, unknown>
  [k: string]: unknown
}

/** Right-hand user detail sheet: overview facts, raw JSON, and actions. */
export function UserPanel({ user, onClose, onChanged }: { user: AuthUser; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState('overview')
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function del() {
    try {
      await api.deleteUser(user.id)
      toast.success('User deleted')
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  async function sendMagic() {
    if (!user.email) return
    try {
      await api.sendMagicLink(user.email)
      toast.success(`Magic link sent — check /inbox in dev`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      width="w-[480px]"
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{user.email || (user.is_anonymous ? 'Anonymous user' : user.id.slice(0, 12))}</span>
          {user.is_anonymous && <Badge variant="neutral">anon</Badge>}
        </span>
      }
      footer={
        <>
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 size={13} /> Delete user
          </Button>
          <SheetClose asChild>
            <Button variant="outline" className="ml-auto">
              Done
            </Button>
          </SheetClose>
        </>
      }
    >
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'json', label: 'Raw JSON' },
        ]}
        active={tab}
        onSelect={setTab}
      />

      {tab === 'overview' && (
        <div className="mt-4 space-y-5">
          <div>
            {(
              [
                ['User UID', user.id, true],
                ['Email', user.email ?? '—', false],
                ['Created at', <Time value={user.created_at} />, false],
                ['Updated at', <Time value={user.updated_at} />, false],
                ['Confirmation sent at', <Time value={user.confirmation_sent_at} />, false],
                ['Confirmed at', <Time value={user.email_confirmed_at} />, false],
                ['Last signed in', <Time value={user.last_sign_in_at} />, false],
              ] as [string, React.ReactNode, boolean][]
            ).map(([label, value, copyable]) => (
              <div key={label} className="flex items-center justify-between gap-4 border-b border-border/60 py-2 text-[13px] last:border-0">
                <span className="shrink-0 text-muted-foreground">{label}</span>
                <span className="flex min-w-0 items-center gap-1 font-mono text-foreground/90">
                  <span className="truncate">{value}</span>
                  {copyable && <CopyButton value={String(value)} label={label} iconSize={11} />}
                </span>
              </div>
            ))}
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Provider information</p>
            <div className="rounded-md border border-border bg-card p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium capitalize text-foreground">
                  {(user.app_metadata?.provider as string) ?? (user.is_anonymous ? 'anonymous' : 'email')}
                </span>
                <Badge variant="brand">enabled</Badge>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground/80">
                {user.is_anonymous ? 'Signed in anonymously — no credentials attached.' : 'How this user authenticates with your project.'}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Actions</p>
            <div className="space-y-2">
              {!user.is_anonymous && (
                <>
                  <ActionRow
                    icon={KeyRound}
                    title="Reset password"
                    description="Set a new password for the user directly."
                    action={
                      <Button variant="outline" size="xs" onClick={() => setResetting(true)}>
                        Reset password
                      </Button>
                    }
                  />
                  <ActionRow
                    icon={Mail}
                    title="Send magic link"
                    description="Send a passwordless sign-in link to the user."
                    action={
                      <Button variant="outline" size="xs" onClick={() => void sendMagic()} disabled={!user.email}>
                        Send magic link
                      </Button>
                    }
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'json' && (
        <div className="mt-4">
          <CodeView value={JSON.stringify(user, null, 2)} lang="js" readOnly minLines={10} maxLines={400} />
        </div>
      )}

      {resetting && (
        <ResetPasswordDialog
          user={user}
          onClose={() => setResetting(false)}
          onDone={() => {
            setResetting(false)
            toast.success('Password updated')
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          open
          danger
          title={`Delete user ${user.email || user.id.slice(0, 8)}?`}
          description="The user and their sessions will be permanently removed."
          confirmLabel="Delete user"
          onConfirm={() => void del()}
          onClose={() => setDeleting(false)}
        />
      )}
    </Sheet>
  )
}

function ActionRow({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof KeyRound
  title: string
  description: string
  action: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3.5">
      <Icon size={15} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground/80">{description}</p>
      </div>
      {action}
    </div>
  )
}

function ResetPasswordDialog({ user, onClose, onDone }: { user: AuthUser; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setErr('')
    try {
      await api.updateUser(user.id, { password })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} title={`Reset password · ${user.email || user.id.slice(0, 8)}`}>
      <div className="space-y-3">
        <div>
          <Label>New password (min 6 characters)</Label>
          <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && password.length >= 6 && void submit()} />
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy || password.length < 6}>
            {busy ? 'Saving…' : 'Update password'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
