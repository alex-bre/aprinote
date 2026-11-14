import type { VaultIndex } from './tree'
import type { PageMeta } from './types'

/**
 * Full-text search across the vault.
 *
 * The scan already reads every page, so it also keeps each one's plain text —
 * there is no separate index to build or invalidate. Matching is deliberately
 * plain: a title hit outranks a body hit, and a body hit carries the sentence it
 * was found in so the result is readable without opening the page.
 */

export interface SearchHit {
  page: PageMeta
  /** Where it matched — titles are what people usually mean. */
  where: 'title' | 'path' | 'text'
  /** The surrounding text, for a body match. */
  snippet: string
  rank: number
}

const SNIPPET_BEFORE = 34
const SNIPPET_AFTER = 96

function snippetAround(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE)
  const end = Math.min(text.length, at + length + SNIPPET_AFTER)
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
}

export function searchVault(index: VaultIndex, query: string, limit = 20): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const hits: SearchHit[] = []

  for (const [path, page] of index.pages) {
    const title = page.title.toLowerCase()

    const inTitle = title.indexOf(needle)
    if (inTitle !== -1) {
      // An exact title beats a title that merely contains the words.
      hits.push({ page, where: 'title', snippet: '', rank: 3000 - inTitle - (title === needle ? 0 : 100) })
      continue
    }

    const body = index.text.get(path) ?? ''
    const inBody = body.toLowerCase().indexOf(needle)
    if (inBody !== -1) {
      hits.push({
        page,
        where: 'text',
        snippet: snippetAround(body, inBody, needle.length),
        rank: 2000 - Math.min(inBody, 1500),
      })
      continue
    }

    const inPath = path.toLowerCase().indexOf(needle)
    if (inPath !== -1) hits.push({ page, where: 'path', snippet: path, rank: 1000 - inPath })
  }

  return hits
    .sort((a, b) => b.rank - a.rank || a.page.title.localeCompare(b.page.title))
    .slice(0, limit)
}

/** Asset files no page references any more. Offered, never swept automatically. */
export function unusedAssets(assetFiles: string[], index: VaultIndex): string[] {
  return assetFiles.filter((name) => !index.assetRefs.has(name)).sort()
}
