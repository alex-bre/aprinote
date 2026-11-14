import {
  ChevronRight,
  Clock,
  CodeXml,
  Columns2,
  Eye,
  Moon,
  PanelLeft,
  Menu,
  Redo2,
  Search,
  SlidersHorizontal,
  Sun,
  Type,
  Undo2,
} from 'lucide-react'
import { breadcrumbFor } from '@/vault/tree'
import { useSession, type Mode } from '@/store/sessionStore'
import { useEditor } from '@/store/editorStore'
import { useTheme, type Theme } from '@/store/themeStore'
import { useVault } from '@/store/vaultStore'
import { relativeTime } from './relativeTime'
import styles from './TopBar.module.css'

const TABS: { mode: Mode; label: string; Icon: typeof Type }[] = [
  { mode: 'edit', label: 'Edit', Icon: Type },
  { mode: 'split', label: 'Split', Icon: Columns2 },
  { mode: 'preview', label: 'Preview', Icon: Eye },
]

const STYLESHEET_TABS: typeof TABS = [
  { mode: 'split', label: 'Source', Icon: CodeXml },
  { mode: 'preview', label: 'Preview', Icon: Eye },
]

/** Two themes; the icon shows the one in force and the click swaps to the other. */
const THEMES: Record<Theme, { Icon: typeof Sun; label: string }> = {
  light: { Icon: Sun, label: 'Switch to the dark theme' },
  dark: { Icon: Moon, label: 'Switch to the light theme' },
}

const CYCLE_LABEL: Record<Mode, string> = { edit: 'Edit', split: 'HTML', preview: 'View' }

export function TopBar({ mobile, onSearch }: { mobile?: boolean; onSearch?: () => void }) {
  const mode = useSession((s) => s.mode)
  const setMode = useSession((s) => s.setMode)
  const toggleSidebar = useSession((s) => s.toggleSidebar)
  const setDrawer = useSession((s) => s.setDrawer)
  const cycleMode = useSession((s) => s.cycleMode)
  const inspectorOpen = useSession((s) => s.inspectorOpen)
  const toggleInspector = useSession((s) => s.toggleInspector)
  const surface = useEditor((s) => s.surface)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const theme = useTheme((s) => s.theme)
  const toggleTheme = useTheme((s) => s.toggleTheme)
  const page = useVault((s) => s.page)
  const stylesheet = useVault((s) => s.stylesheet)
  const tree = useVault((s) => s.index?.tree ?? [])
  // A stylesheet has no WYSIWYG, so the tabs collapse to Source + Preview.
  const tabs = stylesheet ? STYLESHEET_TABS : TABS
  const { Icon: ThemeIcon, label: themeLabel } = THEMES[theme]

  const crumbs = page ? breadcrumbFor(page.meta.path, tree) : []

  // The phone gets one row — a drawer button, the title, the mode cycle and
  // search — with everything it drops moved to the meta strip below.
  if (mobile) {
    const { Icon: ModeIcon } = (stylesheet ? STYLESHEET_TABS : TABS).find((t) => t.mode === mode) ?? TABS[0]
    return (
      <>
        <div className={`${styles.bar} ${styles.mobile}`}>
          <button className={styles.iconBtn} onClick={() => setDrawer(true)} title="Pages">
            <Menu size={19} />
          </button>
          <div className={styles.crumbs}>
            <span className={styles.title}>{page?.meta.title ?? 'No page open'}</span>
          </div>
          <button className={styles.cycle} onClick={cycleMode} title="Edit → HTML → View">
            <ModeIcon size={15} />
            {CYCLE_LABEL[mode]}
          </button>
          <button className={styles.iconBtn} onClick={onSearch} title="Search (⌘K)">
            <Search size={18} />
          </button>
          <button className={styles.iconBtn} onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
            <ThemeIcon size={17} />
          </button>
        </div>

        <div className={styles.meta}>
          {crumbs.map((folder) => (
            <span key={folder}>{folder} ›</span>
          ))}
          {page && !page.meta.id.startsWith('path:') && <code>{page.meta.id}</code>}
          {page?.meta.editedAt && (
            <span className={styles.spacer}>edited {relativeTime(page.meta.editedAt)}</span>
          )}
        </div>
      </>
    )
  }

  return (
    <div className={styles.bar}>
      <button className={styles.iconBtn} onClick={toggleSidebar} title="Toggle sidebar">
        <PanelLeft size={16} />
      </button>

      <div className={styles.crumbs}>
        {crumbs.map((folder) => (
          <span className={styles.crumb} key={folder}>
            <span>{folder}</span>
            <ChevronRight size={13} color="var(--fg-ghost)" style={{ flex: 'none' }} />
          </span>
        ))}
        <span className={styles.title}>{page?.meta.title ?? 'No page open'}</span>
        {page && !page.meta.id.startsWith('path:') && (
          <span className={styles.idChip}>id: {page.meta.id}</span>
        )}
      </div>

      {page?.meta.editedAt && (
        <div className={styles.edited}>
          <Clock size={13} />
          <span>edited {relativeTime(page.meta.editedAt)}</span>
        </div>
      )}

      <div className={styles.tabs}>
        {tabs.map(({ mode: m, label, Icon }) => (
          <button
            key={m}
            className={`${styles.tab} ${
              (stylesheet ? (m === 'preview') === (mode === 'preview') : mode === m)
                ? styles.on
                : ''
            }`}
            onClick={() => setMode(m)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className={styles.actions}>
        <button className={styles.iconBtn} onClick={toggleTheme} title={themeLabel} aria-label={themeLabel}>
          <ThemeIcon size={15} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => surface?.undo()}
          disabled={!canUndo}
          title="Undo (⌘Z)"
        >
          <Undo2 size={15} />
        </button>
        <button
          className={styles.iconBtn}
          onClick={() => surface?.redo()}
          disabled={!canRedo}
          title="Redo (⇧⌘Z)"
        >
          <Redo2 size={15} />
        </button>
        <button
          className={`${styles.iconBtn} ${inspectorOpen ? styles.on : ''}`}
          onClick={toggleInspector}
          title="Toggle inspector"
        >
          <SlidersHorizontal size={15} />
        </button>
      </div>
    </div>
  )
}
