import { useEffect, useMemo, useState } from 'react'
import { CornerDownLeft, FileCode } from 'lucide-react'
import type { PageTarget } from '@/editor/commands/pagelink'
import type { PageMeta } from '@/vault/types'
import styles from './PagePicker.module.css'

/**
 * The page-search list shared by the `[[` input rule and the ⌘K dialog, so both
 * entry points rank and present pages identically.
 */

/** Subsequence match, so "revproc" finds "Review Process". */
function score(title: string, path: string, query: string): number {
  if (!query) return 1
  const haystack = `${title} ${path}`.toLowerCase()
  const needle = query.toLowerCase()

  const direct = haystack.indexOf(needle)
  if (direct !== -1) return 1000 - direct

  let at = 0
  let gaps = 0
  for (const character of needle) {
    const found = haystack.indexOf(character, at)
    if (found === -1) return 0
    gaps += found - at
    at = found + 1
  }
  return Math.max(1, 500 - gaps)
}

export function rankPages(pages: PageMeta[], query: string, limit = 8): PageMeta[] {
  return pages
    .map((page) => ({ page, rank: score(page.title, page.path, query) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.page.title.localeCompare(b.page.title))
    .slice(0, limit)
    .map((entry) => entry.page)
}

export function PagePicker({
  pages,
  query,
  onPick,
  onCancel,
  emptyLabel = 'No matching page',
}: {
  pages: PageMeta[]
  query: string
  onPick: (target: PageTarget) => void
  onCancel: () => void
  emptyLabel?: string
}) {
  const matches = useMemo(() => rankPages(pages, query), [pages, query])
  const [active, setActive] = useState(0)

  useEffect(() => setActive(0), [query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        return onCancel()
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        return setActive((at) => (at + 1) % Math.max(1, matches.length))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return setActive((at) => (at - 1 + matches.length) % Math.max(1, matches.length))
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const page = matches[active]
        if (!page) return
        event.preventDefault()
        event.stopPropagation()
        onPick({ id: page.id, path: page.path, title: page.title })
      }
    }
    // Capture, so the editor's own Enter and Tab handling never runs first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [matches, active, onPick, onCancel])

  if (matches.length === 0) {
    return <div className={styles.empty}>{emptyLabel}</div>
  }

  return (
    <div className={styles.list} role="listbox" aria-label="Pages">
      {matches.map((page, index) => (
        <button
          key={page.path}
          className={`${styles.item} ${index === active ? styles.on : ''}`}
          role="option"
          aria-selected={index === active}
          onMouseEnter={() => setActive(index)}
          onClick={() => onPick({ id: page.id, path: page.path, title: page.title })}
        >
          <FileCode size={14} />
          <span className={styles.title}>{page.title}</span>
          <code className={styles.path}>{page.path}</code>
          {index === active && <CornerDownLeft size={13} className={styles.enter} />}
        </button>
      ))}
    </div>
  )
}
