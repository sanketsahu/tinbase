/**
 * Studio preferences — tiny localStorage-backed stores with live subscribers,
 * so changing a preference anywhere (e.g. the Settings page) hot-updates every
 * consumer without a reload.
 *
 * @module
 */
import { useSyncExternalStore } from 'react'

function createPref<T extends string>(key: string, fallback: T, valid: readonly T[]) {
  let value: T = (() => {
    const v = localStorage.getItem(key)
    return valid.includes(v as T) ? (v as T) : fallback
  })()
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (v: T) => {
      value = v
      localStorage.setItem(key, v)
      listeners.forEach((l) => l())
    },
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

/* ── theme ── */

export type ThemePref = 'dark' | 'light' | 'system'
export const THEME_PREFS: readonly ThemePref[] = ['dark', 'light', 'system']

const themePref = createPref<ThemePref>('tinbase_theme', 'dark', THEME_PREFS)
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  return pref === 'system' ? (media.matches ? 'dark' : 'light') : pref
}

function applyTheme() {
  document.documentElement.classList.toggle('dark', resolveTheme(themePref.get()) === 'dark')
}
applyTheme()
themePref.subscribe(applyTheme)
media.addEventListener('change', () => {
  applyTheme()
  themePref.set(themePref.get())
})

/** The stored preference (dark / light / system) + setter. */
export function useThemePref(): [ThemePref, (p: ThemePref) => void] {
  const pref = useSyncExternalStore(themePref.subscribe, themePref.get)
  return [pref, themePref.set]
}

/** The effective theme after resolving `system`. */
export function useResolvedTheme(): 'dark' | 'light' {
  const pref = useSyncExternalStore(themePref.subscribe, themePref.get)
  return resolveTheme(pref)
}

/* ── sidebar mode ── */

export type SidebarMode = 'expanded' | 'collapsed' | 'hover'
export const SIDEBAR_MODES: readonly SidebarMode[] = ['expanded', 'collapsed', 'hover']

const sidebarMode = createPref<SidebarMode>('tinbase_sidebar', 'hover', SIDEBAR_MODES)

/** Sidebar behavior preference + setter (live across the app). */
export function useSidebarMode(): [SidebarMode, (m: SidebarMode) => void] {
  const mode = useSyncExternalStore(sidebarMode.subscribe, sidebarMode.get)
  return [mode, sidebarMode.set]
}
