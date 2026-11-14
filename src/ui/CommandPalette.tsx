import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  FileCode,
  FilePlus,
  FolderPlus,
  Moon,
  Paintbrush,
  Search,
  Settings as SettingsIcon,
  Sun,
  Type,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from '@/store/sessionStore'
import { useTheme } from '@/store/themeStore'
import { useVault } from '@/store/vaultStore'
import { searchVault, type SearchHit } from '@/vault/search'
import styles from './CommandPalette.module.css'

/**
 * ⌘K — search and commands in one list.
 *
 * Typing searches page titles *and* page text; the commands filter alongside, so
 * there is one thing to reach for rather than two. Opening it over a selection is
 * the one case that means something else — that is the link dialog, and the
 * document pane handles it before this ever opens.
 */

interface Action {
  label: string
  hint?: string
  Icon: LucideIcon
  keywords: string
  run: () => void
}

export function CommandPalette({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void
  onOpenSettings: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const index = useVault((s) => s.index)
  const openPage = useVault((s) => s.openPage)
  const createPage = useVault((s) => s.createPage)
  const createFolder = useVault((s) => s.createFolder)
  const openStylesheet = useVault((s) => s.openStylesheet)
  const setMode = useSession((s) => s.setMode)
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggleTheme)

  const actions: Action[] = useMemo(
    () => [
      {
        label: 'New page',
        Icon: FilePlus,
        keywords: 'create add note',
        run: () => void createPage(''),
      },
      {
        label: 'New folder',
        Icon: FolderPlus,
        keywords: 'create add directory',
        run: () => {
          const name = window.prompt('Folder name')
          if (name?.trim()) void createFolder('', name.trim())
        },
      },
      { label: 'Edit', hint: 'WYSIWYG', Icon: Type, keywords: 'wysiwyg write mode', run: () => setMode('edit') },
      { label: 'Split', hint: 'HTML', Icon: FileCode, keywords: 'source html code mode', run: () => setMode('split') },
      { label: 'Preview', hint: 'read', Icon: ArrowRight, keywords: 'read view device mode', run: () => setMode('preview') },
      {
        label: 'Edit vault stylesheet',
        hint: 'site.css',
        Icon: Paintbrush,
        keywords: 'css style theme design',
        run: () => void openStylesheet(),
      },
      {
        label: theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
        Icon: theme === 'dark' ? Sun : Moon,
        keywords: 'dark light theme appearance colour',
        run: toggleTheme,
      },
      {
        label: 'Settings',
        Icon: SettingsIcon,
        keywords: 'palette colours assets cleanup preferences',
        run: onOpenSettings,
      },
    ],
    [createPage, createFolder, setMode, openStylesheet, theme, toggleTheme, onOpenSettings],
  )

  const matchedActions = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return actions
    return actions.filter(
      (action) => action.label.toLowerCase().includes(needle) || action.keywords.includes(needle),
    )
  }, [actions, query])

  const hits: SearchHit[] = useMemo(
    () => (index && query.trim() ? searchVault(index, query) : []),
    [index, query],
  )

  const total = matchedActions.length + hits.length
  useEffect(() => setActive(0), [query])

  const choose = (at: number) => {
    onClose()
    if (at < matchedActions.length) return matchedActions[at].run()
    const hit = hits[at - matchedActions.length]
    if (hit) void openPage(hit.page.path)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose()
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        return setActive((at) => (at + 1) % Math.max(1, total))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return setActive((at) => (at - 1 + total) % Math.max(1, total))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (total) choose(active)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.field}>
          <Search size={16} />
          <input
            autoFocus
            value={query}
            placeholder="Search pages and commands…"
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>esc</kbd>
        </div>

        <div className={styles.results}>
          {total === 0 && <div className={styles.empty}>Nothing matches “{query}”</div>}

          {matchedActions.length > 0 && <div className={styles.group}>Commands</div>}
          {matchedActions.map((action, index) => (
            <button
              key={action.label}
              className={`${styles.row} ${index === active ? styles.on : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(index)}
            >
              <action.Icon size={15} />
              <span className={styles.label}>{action.label}</span>
              {action.hint && <code className={styles.hint}>{action.hint}</code>}
            </button>
          ))}

          {hits.length > 0 && <div className={styles.group}>Pages</div>}
          {hits.map((hit, index) => {
            const at = matchedActions.length + index
            return (
              <button
                key={hit.page.path}
                className={`${styles.row} ${at === active ? styles.on : ''}`}
                onMouseEnter={() => setActive(at)}
                onClick={() => choose(at)}
              >
                <FileCode size={15} />
                <span className={styles.label}>{hit.page.title}</span>
                {hit.where === 'text' ? (
                  <span className={styles.snippet}>{hit.snippet}</span>
                ) : (
                  <code className={styles.hint}>{hit.page.path}</code>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
