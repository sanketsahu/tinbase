import {
  GitBranch,
  HardDrive,
  Home,
  KeyRound,
  Radio,
  ScrollText,
  Settings,
  Table2,
  Terminal,
  Workflow,
  Zap,
} from 'lucide-react'

export type Tab =
  | 'home'
  | 'table'
  | 'sql'
  | 'database'
  | 'auth'
  | 'storage'
  | 'functions'
  | 'realtime'
  | 'automations'
  | 'logs'
  | 'settings'

export interface NavEntry {
  id: Tab
  label: string
  icon: typeof Table2
}

export interface NavSection {
  title: string | null
  items: NavEntry[]
}

/** Ordered sidebar navigation sections and their entries, grouped by area. */
export const NAV_SECTIONS: NavSection[] = [
  { title: null, items: [{ id: 'home', label: 'Project overview', icon: Home }] },
  {
    title: 'Database',
    items: [
      { id: 'table', label: 'Table Editor', icon: Table2 },
      { id: 'sql', label: 'SQL Editor', icon: Terminal },
      { id: 'database', label: 'Database', icon: GitBranch },
    ],
  },
  {
    title: 'Manage',
    items: [
      { id: 'auth', label: 'Authentication', icon: KeyRound },
      { id: 'storage', label: 'Storage', icon: HardDrive },
      { id: 'functions', label: 'Edge Functions', icon: Zap },
      { id: 'realtime', label: 'Realtime', icon: Radio },
    ],
  },
  { title: 'Automations', items: [{ id: 'automations', label: 'Automations', icon: Workflow }] },
  { title: 'Observe', items: [{ id: 'logs', label: 'Logs', icon: ScrollText }] },
  { title: 'Project', items: [{ id: 'settings', label: 'Project Settings', icon: Settings }] },
]
