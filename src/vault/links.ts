import { LINK_ATTR } from './format'
import { relativeHref } from './paths'

/**
 * Stable page links.
 *
 * Stored as `<a data-aprinote="pg_2c81" href="../specs/review-process.html">…</a>`.
 * `data-aprinote` is the truth the app resolves against; `href` is **derived** —
 * recomputed on every save and on any rename or move, so the raw files stay
 * clickable as a plain static site.
 *
 * These functions read raw files, so they also accept the pre-rename
 * `data-leaf` (see `format.ts`): an old vault keeps its links and backlinks
 * before any page in it has been saved again.
 */

export { LINK_ATTR }

/** One outgoing link, as written in a page. */
export interface OutgoingLink {
  /** The `data-aprinote` id it points at. */
  id: string
  /** Its link text, used to keep titles in step on rename. */
  text: string
}

/** One inbound link, for the backlinks panel. */
export interface Backlink {
  /** The page doing the linking. */
  id: string
  path: string
  title: string
  text: string
}

const ANCHOR = /<a\b[^>]*\bdata-(?:aprinote|leaf)\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
const ANCHOR_OPEN = /(<a\b[^>]*\bdata-(?:aprinote|leaf)\s*=\s*["']([^"']+)["'][^>]*>)/gi

/** Every stable page link in a document, in order. */
export function linksIn(html: string): OutgoingLink[] {
  const links: OutgoingLink[] = []
  for (const [, id, text] of html.matchAll(ANCHOR)) {
    links.push({ id, text: text.replace(/<[^>]+>/g, '').trim() })
  }
  return links
}

/**
 * Invert a map of page → outgoing ids into target id → inbound pages. This is the
 * whole backlink index; it is rebuilt by a scan and never persisted, because the
 * files are the truth.
 */
export function buildBacklinks(
  outgoing: Map<string, OutgoingLink[]>,
  pages: Map<string, { id: string; title: string }>,
  byId: Map<string, string>,
): Map<string, Backlink[]> {
  const backlinks = new Map<string, Backlink[]>()

  for (const [path, links] of outgoing) {
    const source = pages.get(path)
    if (!source) continue

    for (const link of links) {
      // Only real targets get a backlink; a dangling id has nothing to link back to.
      if (!byId.has(link.id)) continue
      const list = backlinks.get(link.id) ?? []
      // One entry per source page, however many times it links.
      if (!list.some((entry) => entry.path === path)) {
        list.push({ id: source.id, path, title: source.title, text: link.text })
      }
      backlinks.set(link.id, list)
    }
  }
  return backlinks
}

/**
 * Recompute the `href` of every stable link in a page. `href` is derived, so it is
 * rewritten from scratch rather than patched.
 *
 * An unresolvable id keeps its last known href — the static site then degrades
 * gracefully instead of pointing at nothing.
 */
export function rewritePageLinks(
  html: string,
  pagePath: string,
  resolve: (id: string) => string | undefined,
): string {
  return html.replace(
    ANCHOR_OPEN,
    (tag: string, _all: string, id: string) => {
      const target = resolve(id)
      if (!target) return tag
      const href = relativeHref(pagePath, target)
      return /\bhref\s*=/.test(tag)
        ? tag.replace(/(\bhref\s*=\s*["'])[^"']*(["'])/i, `$1${href}$2`)
        : tag.replace(/<a\b/i, `<a href="${href}"`)
    },
  )
}

/**
 * Update the link *text* of links whose target was renamed, but only where the
 * text still matched the old title — a hand-written label is left alone.
 */
export function retitleLinks(html: string, id: string, from: string, to: string): string {
  if (!from || from === to) return html
  return html.replace(ANCHOR, (tag, linkId: string, text: string) => {
    if (linkId !== id || text.trim() !== from) return tag
    return tag.replace(`>${text}<`, `>${to}<`)
  })
}

/** The markup a page link is inserted as. */
export function pageLinkHtml(id: string, href: string, text: string): string {
  const label = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<a ${LINK_ATTR}="${id}" href="${href}">${label}</a>`
}
