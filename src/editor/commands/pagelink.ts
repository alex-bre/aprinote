import type { Command, SurfaceOptions } from '../EditorSurface'
import { LINK_ATTR, pageLinkHtml } from '@/vault/links'
import { relativeHref } from '@/vault/paths'
import { closestIn, currentRange, selectRange, wrapEach } from './range'

/**
 * Stable page links, from the editor's side.
 *
 * `data-aprinote` is the truth; `href` is derived. The three entry points — the `[[`
 * input rule, the ⌘K dialog and a page dragged from the sidebar — all land here,
 * so they all produce identical markup.
 */

/** Editor-only: an id nothing resolves to renders as a muted chip. */
export const BROKEN = 'data-aprinote-broken'

export interface PageTarget {
  id: string
  path: string
  title: string
}

/**
 * Flag links whose target has gone. The `href` is deliberately left as last known
 * so the page still degrades gracefully opened straight off disk.
 */
export function markBrokenLinks(root: HTMLElement, options?: SurfaceOptions): void {
  const resolve = options?.resolveLink
  if (!resolve) return

  for (const anchor of root.querySelectorAll<HTMLElement>(`a[${LINK_ATTR}]`)) {
    const id = anchor.getAttribute(LINK_ATTR) ?? ''
    const target = resolve(id)
    if (target) {
      anchor.removeAttribute(BROKEN)
      // href is derived — keep it correct as the vault moves underneath.
      anchor.setAttribute('href', relativeHref(options!.pagePath, target.path))
    } else {
      anchor.setAttribute(BROKEN, '')
    }
  }
}

/**
 * Insert or retarget a page link. With a selection the selected text becomes the
 * label; without one the page's title is inserted.
 */
export const insertPageLink: Command = (root, args, options) => {
  const target = args as PageTarget | null
  const range = currentRange(root)
  if (!range) return

  const existing = closestIn(root, range.startContainer, (el) => el.tagName === 'A')

  if (!target) {
    // Unlinking: keep the words, drop the anchor.
    if (!existing) return
    const parent = existing.parentNode
    while (existing.firstChild) parent?.insertBefore(existing.firstChild, existing)
    existing.remove()
    return
  }

  const href = relativeHref(options?.pagePath ?? '', target.path)

  if (existing) {
    existing.setAttribute(LINK_ATTR, target.id)
    existing.setAttribute('href', href)
    existing.removeAttribute('target')
    existing.removeAttribute('rel')
    return
  }

  if (range.collapsed) {
    // Nothing selected — insert the page's title as the label.
    const fragment = root.ownerDocument.createElement('template')
    fragment.innerHTML = pageLinkHtml(target.id, href, target.title)
    const anchor = fragment.content.firstElementChild
    if (!anchor) return
    range.insertNode(anchor)
    range.setStartAfter(anchor)
    range.collapse(true)
    selectRange(root, range)
    return
  }

  wrapEach(range, () => {
    const anchor = root.ownerDocument.createElement('a')
    anchor.setAttribute(LINK_ATTR, target.id)
    anchor.setAttribute('href', href)
    return anchor
  })
  selectRange(root, range)
}
