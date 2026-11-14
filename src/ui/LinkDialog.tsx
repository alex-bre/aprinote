import { useEffect, useState } from 'react'
import { Link2, Search } from 'lucide-react'
import type { PageTarget } from '@/editor/commands/pagelink'
import { useEditor } from '@/store/editorStore'
import { useVault } from '@/store/vaultStore'
import { PagePicker } from './PagePicker'
import styles from './PagePicker.module.css'

/**
 * ⌘K — the link dialog. Two tabs: an external URL, and a page search that emits
 * the same `data-aprinote` markup as `[[` and a sidebar drag.
 */
export function LinkDialog({ onClose }: { onClose: () => void }) {
  const surface = useEditor((s) => s.surface)
  const index = useVault((s) => s.index)
  const openPath = useVault((s) => s.page?.meta.path)
  const [tab, setTab] = useState<'page' | 'url'>('page')
  const [query, setQuery] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Linking a page to itself is never what you meant.
  const pages = [...(index?.pages.values() ?? [])].filter((page) => page.path !== openPath)

  const pick = (target: PageTarget) => {
    onClose()
    surface?.exec('pageLink', target)
  }

  const applyUrl = () => {
    onClose()
    if (query.trim()) surface?.exec('link', query.trim())
  }

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'page' ? styles.on : ''}`}
            onClick={() => setTab('page')}
          >
            Link to page
          </button>
          <button
            className={`${styles.tab} ${tab === 'url' ? styles.on : ''}`}
            onClick={() => setTab('url')}
          >
            External URL
          </button>
        </div>

        <div className={styles.field}>
          {tab === 'page' ? <Search size={15} /> : <Link2 size={15} />}
          <input
            autoFocus
            value={query}
            placeholder={tab === 'page' ? 'Search pages…' : 'https://…'}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (tab === 'url' && event.key === 'Enter') applyUrl()
            }}
          />
          {tab === 'url' && <button onClick={applyUrl}>Link</button>}
        </div>

        {tab === 'page' && (
          <PagePicker
            pages={pages}
            query={query}
            onPick={pick}
            onCancel={onClose}
            emptyLabel={pages.length ? 'No matching page' : 'This vault has no other pages yet'}
          />
        )}
      </div>
    </div>
  )
}
