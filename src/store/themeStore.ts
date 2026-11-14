import { create } from 'zustand'

export type Theme = 'light' | 'dark'

const KEY = 'aprinote.theme'
/** Where the theme was kept before the rename; still read, never written. */
const LEGACY_KEY = 'leaf.theme'
const QUERY = '(prefers-color-scheme: dark)'

/**
 * UI preference, not vault data — this is the one place the app talks to browser
 * storage outside `vault/adapters/`, and it stays here so the portability rule
 * holds for everything that touches a user's notes. A Tauri webview keeps
 * localStorage, so this survives the port unchanged.
 *
 * There are two themes, not three. "System" is not a third choice the user picks,
 * it is what happens before they pick: with nothing stored we set no `data-theme`
 * at all and the `light-dark()` tokens resolve against the OS on their own, so the
 * default tracks the system live. The first toggle pins a choice.
 */
function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY)
    if (value === 'light' || value === 'dark') return value
  } catch {
    // Private mode or blocked site data — fall back to following the system.
  }
  return null
}

function systemTheme(): Theme {
  return window.matchMedia?.(QUERY).matches ? 'dark' : 'light'
}

function apply(theme: Theme | null) {
  const root = document.documentElement
  if (theme === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}

interface ThemeState {
  theme: Theme
  /** False until the user picks one — the theme is the system's, and follows it. */
  pinned: boolean
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  /** Back to following the system preference. */
  clearTheme: () => void
}

const initial = stored()
apply(initial)

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initial ?? systemTheme(),
  pinned: initial !== null,

  setTheme: (theme) => {
    apply(theme)
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // Preference just won't survive a reload.
    }
    set({ theme, pinned: true })
  },

  toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),

  clearTheme: () => {
    apply(null)
    try {
      localStorage.removeItem(KEY)
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      // Nothing was stored to begin with.
    }
    set({ theme: systemTheme(), pinned: false })
  },
}))

// While unpinned the chrome follows the OS switching under it, not just at load.
window.matchMedia?.(QUERY).addEventListener?.('change', () => {
  if (!useTheme.getState().pinned) useTheme.setState({ theme: systemTheme() })
})
