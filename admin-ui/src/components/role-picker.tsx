import { Check, ChevronDown, Database, UserRound, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Button, Popover, Select, toast } from './ui'

/** A role to preview data as: the postgres superuser, the anonymous role, or a specific authenticated user. */
export type RolePreview =
  | { kind: 'postgres' }
  | { kind: 'anon' }
  | { kind: 'authenticated'; sub: string; email?: string }

const CARDS = [
  {
    kind: 'postgres' as const,
    icon: Database,
    title: 'Postgres',
    sub: 'Superuser',
    blurb: 'Full admin access — the service_role, which bypasses all Row Level Security (RLS) policies.',
  },
  {
    kind: 'anon' as const,
    icon: UserRound,
    title: 'Anonymous',
    sub: 'Not logged in',
    blurb: 'The anon key — what an unauthenticated visitor sees. RLS policies apply.',
  },
  {
    kind: 'authenticated' as const,
    icon: Users,
    title: 'Authenticated',
    sub: 'Specific logged in user',
    blurb: 'Impersonate a real user — auth.uid() resolves to them. RLS policies apply.',
  },
]

/**
 * "View data as a role" picker — switches the effective role used to preview data:
 * postgres (service key), anon, or an impersonated authenticated user.
 *
 * @param value - The currently selected role preview.
 * @param onChange - Called with the newly selected role and the token to use for it
 *   (`null` for postgres, an anon/impersonation token otherwise).
 * @param align - Which trigger edge the popover panel aligns to; use `'start'` when
 *   the picker sits near the left edge of the viewport so it can't overflow off-screen.
 * @returns The role picker popover.
 */
export function RolePicker({
  value,
  onChange,
  align = 'end',
}: {
  value: RolePreview
  onChange: (r: RolePreview, token: string | null) => void
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [users, setUsers] = useState<{ id: string; email?: string }[]>([])

  useEffect(() => {
    if (open && users.length === 0) api.users().then(setUsers, () => {})
  }, [open, users.length])

  async function pick(kind: RolePreview['kind'], user?: { id: string; email?: string }) {
    try {
      if (kind === 'postgres') {
        onChange({ kind: 'postgres' }, null)
      } else if (kind === 'anon') {
        const { anonKey } = await api.keys()
        const token = anonKey ?? (await api.impersonate('anon')).token
        onChange({ kind: 'anon' }, token)
      } else {
        if (!user) return
        const { token } = await api.impersonate('authenticated', { sub: user.id, email: user.email })
        onChange({ kind: 'authenticated', sub: user.id, email: user.email }, token)
      }
      if (kind !== 'authenticated' || user) setOpen(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const label = value.kind === 'authenticated' ? (value.email ?? value.sub.slice(0, 8)) : value.kind
  const active = CARDS.find((c) => c.kind === value.kind)!

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align={align}
      className="w-105 p-3"
      trigger={
        <Button variant="outline" size="xs" onClick={() => setOpen((o) => !o)}>
          Role <span className={'font-mono ' + (value.kind === 'postgres' ? 'text-foreground' : 'text-brand')}>{label}</span>
          <ChevronDown size={11} />
        </Button>
      }
    >
      <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">View data as a role</p>
      <div className="grid grid-cols-3 gap-2">
        {CARDS.map((c) => {
          const Icon = c.icon
          const selected = value.kind === c.kind
          return (
            <button
              key={c.kind}
              onClick={() => (c.kind === 'authenticated' ? undefined : void pick(c.kind))}
              className={
                'relative rounded-md border p-3 text-left transition-colors ' +
                (selected ? 'border-foreground bg-accent/60' : 'border-input hover:border-muted-foreground')
              }
            >
              {selected && (
                <span className="absolute right-2 top-2 flex size-4 items-center justify-center rounded-full bg-foreground text-background">
                  <Check size={10} strokeWidth={3} />
                </span>
              )}
              <Icon size={15} className="text-muted-foreground" />
              <p className="mt-2 text-[13px] font-medium text-foreground">{c.title}</p>
              <p className="text-[11px] text-muted-foreground/80">{c.sub}</p>
            </button>
          )
        })}
      </div>

      <div className="mt-2">
        <Select
          value={value.kind === 'authenticated' ? value.sub : ''}
          onValueChange={(v) => {
            const u = users.find((x) => x.id === v)
            if (u) void pick('authenticated', u)
          }}
          placeholder={users.length === 0 ? 'No auth users — sign someone up first' : 'Impersonate a user…'}
          disabled={users.length === 0}
          options={users.map((u) => ({ value: u.id, label: u.email ?? u.id }))}
        />
      </div>

      <p className="mt-3 border-t border-border pt-2.5 text-[11px] leading-relaxed text-muted-foreground/80">
        <span className="font-medium text-foreground/80">{active.title}</span>
        {value.kind === 'postgres' && (
          <span className="ml-1.5 rounded border border-input px-1 py-px text-[9px] uppercase text-muted-foreground/80">default</span>
        )}
        <br />
        {active.blurb}
      </p>
    </Popover>
  )
}
