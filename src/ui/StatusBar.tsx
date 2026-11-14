import { AlertTriangle, Command } from 'lucide-react'
import { DEVICE_WIDTH, useSession } from '@/store/sessionStore'
import { useVault, type SaveState } from '@/store/vaultStore'
import styles from './StatusBar.module.css'

function wordCount(fragment: string): number {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'saved to disk',
  dirty: 'unsaved changes',
  saving: 'saving…',
  conflict: 'changed on disk',
  error: 'could not save',
}

export function StatusBar() {
  const mode = useSession((s) => s.mode)
  const device = useSession((s) => s.device)
  const page = useVault((s) => s.page)
  const saveState = useVault((s) => s.saveState)
  const resolveConflict = useVault((s) => s.resolveConflict)

  const modeLabel =
    mode === 'preview'
      ? `preview · ${device === 'fit' ? 'fit to pane' : `${DEVICE_WIDTH[device]}px`}`
      : mode === 'split'
        ? 'split · live sync'
        : 'wysiwyg'

  return (
    <div className={styles.bar}>
      <span className={`${styles.save} ${styles[saveState]}`}>
        {saveState === 'conflict' || saveState === 'error' ? (
          <AlertTriangle size={12} />
        ) : (
          <span className={styles.dot} />
        )}
        {SAVE_LABEL[saveState]}
      </span>

      {saveState === 'conflict' && (
        <span className={styles.resolve}>
          <button onClick={() => void resolveConflict('disk')}>Reload from disk</button>
          <button onClick={() => void resolveConflict('mine')}>Keep mine</button>
        </span>
      )}

      <span>{wordCount(page?.fragment ?? '')} words</span>
      <span>{modeLabel}</span>
      <span className={styles.hint}>
        <Command size={12} />
        press / for blocks · [[ for pages
      </span>
    </div>
  )
}
