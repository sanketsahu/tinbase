import { useSidebarMode, useThemePref, type SidebarMode, type ThemePref } from '../../lib/prefs'
import { SettingsRow, SettingsSection } from './shared'

/** Appearance + interface preferences (applied live, persisted in this browser). */
export function GeneralSettings() {
  const [theme, setTheme] = useThemePref()
  const [sidebar, setSidebar] = useSidebarMode()

  return (
    <SettingsSection title="Appearance" description="Preferences are stored in this browser and apply instantly.">
      <SettingsRow label="Theme" description="Choose your interface color theme. System follows your OS preference." wide>
        <ThemePicker value={theme} onChange={setTheme} />
      </SettingsRow>
      <SettingsRow label="Sidebar" description="How the navigation sidebar behaves." wide>
        <SidebarPicker value={sidebar} onChange={setSidebar} />
      </SettingsRow>
    </SettingsSection>
  )
}

/* ── sidebar picker: mini navigation previews ── */

const SIDEBAR_OPTIONS: { value: SidebarMode; label: string }[] = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'collapsed', label: 'Collapsed' },
  { value: 'hover', label: 'Expand on hover' },
]

/** One nav row: icon dot, optionally followed by a label bar. */
function NavRow({ label }: { label: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
      {label && <div className="h-1 flex-1 rounded-full bg-muted-foreground/25" />}
    </div>
  )
}

function SidebarArt({ variant }: { variant: SidebarMode }) {
  return (
    <div className="absolute inset-0 flex">
      <div
        className={
          'flex shrink-0 flex-col gap-2 border-r border-border bg-accent/50 p-2.5 ' +
          (variant === 'expanded' ? 'w-[42%]' : 'w-[22%]')
        }
      >
        {[0, 1, 2, 3].map((i) => (
          <NavRow key={i} label={variant === 'expanded'} />
        ))}
      </div>

      {variant === 'hover' && (
        <div className="absolute inset-y-0 left-[22%] flex w-[42%] flex-col gap-2 border-r border-border bg-popover/95 p-2.5 shadow-xl backdrop-blur-sm">
          {[0, 1, 2, 3].map((i) => (
            <NavRow key={i} label />
          ))}
        </div>
      )}

      <div className="flex-1 bg-card" />
    </div>
  )
}

function SidebarPicker({ value, onChange }: { value: SidebarMode; onChange: (v: SidebarMode) => void }) {
  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
      {SIDEBAR_OPTIONS.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={
              'group relative flex h-32 flex-col overflow-hidden rounded-lg border-2 text-left transition-colors ' +
              (active ? 'border-brand' : 'border-border hover:border-muted-foreground')
            }
          >
            <div className="relative flex-1 overflow-hidden">
              <SidebarArt variant={o.value} />
            </div>
            <div
              className={
                'flex h-8 shrink-0 items-center border-t px-3 text-xs font-medium transition-colors ' +
                (active
                  ? 'border-brand/40 bg-brand/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground group-hover:text-foreground')
              }
            >
              {o.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/* ── theme picker: mini UI previews ── */

// Illustration palettes are intentionally literal — each thumbnail depicts a
// specific theme regardless of the currently active one.
const THUMB = {
  light: { bg: '#ffffff', panel: '#f4f4f5', line: '#d9d9de', block: '#e8e8ea', card: '#fafafa', border: '#e4e4e7' },
  dark: { bg: '#1c1c1c', panel: '#141414', line: '#3a3a3a', block: '#2a2a2a', card: '#212121', border: '#333333' },
}

function ThumbArt({ variant }: { variant: 'light' | 'dark' }) {
  const c = THUMB[variant]
  return (
    <div className="absolute inset-0 flex gap-2 p-3" style={{ background: c.bg }}>
      {/* sidebar */}
      <div className="flex w-1/4 shrink-0 flex-col gap-1.5 rounded-sm p-1.5" style={{ background: c.panel }}>
        <div className="flex items-center gap-1">
          <div className="h-1.5 w-2/3 rounded-full" style={{ background: c.line }} />
          <div className="ml-auto size-2 rounded-full" style={{ background: c.line }} />
        </div>
        {[80, 60, 70, 50].map((w, i) => (
          <div key={i} className="h-1.5 rounded-full" style={{ width: `${w}%`, background: c.block }} />
        ))}
      </div>
      {/* content */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-sm border p-2" style={{ background: c.card, borderColor: c.border }}>
        <div className="flex items-center gap-1.5">
          <div className="size-2.5 rounded-full" style={{ background: c.block }} />
          <div className="h-1.5 w-1/3 rounded-full" style={{ background: c.line }} />
          <div className="h-1.5 w-1/4 rounded-full" style={{ background: c.block }} />
        </div>
        <div className="h-1.5 w-3/4 rounded-full" style={{ background: c.block }} />
        <div className="mt-auto h-1/2 w-full rounded-sm" style={{ background: c.block }} />
      </div>
    </div>
  )
}

const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

function ThemePicker({ value, onChange }: { value: ThemePref; onChange: (v: ThemePref) => void }) {
  return (
    <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-3">
      {THEME_OPTIONS.map((o) => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={
              'group relative flex h-32 flex-col overflow-hidden rounded-lg border-2 text-left transition-colors ' +
              (active ? 'border-brand' : 'border-border hover:border-muted-foreground')
            }
          >
            <div className="relative flex-1 overflow-hidden">
              {o.value === 'system' ? (
                <>
                  <ThumbArt variant="light" />
                  {/* dark half, split on the diagonal */}
                  <div className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}>
                    <ThumbArt variant="dark" />
                  </div>
                </>
              ) : (
                <ThumbArt variant={o.value} />
              )}
            </div>
            <div
              className={
                'flex h-8 shrink-0 items-center border-t px-3 text-xs font-medium transition-colors ' +
                (active
                  ? 'border-brand/40 bg-brand/10 text-foreground'
                  : 'border-border bg-card text-muted-foreground group-hover:text-foreground')
              }
            >
              {o.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}
