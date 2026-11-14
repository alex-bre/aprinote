import { toVaultPath } from '@/editor/assets/resolve'
import { isNative, openExternal } from '@/platform/native'
import { useVault } from '@/store/vaultStore'
import { INDEX_PAGE, join } from '@/vault/paths'
import type { VaultIndex } from '@/vault/tree'

/**
 * What a click on a link should do.
 *
 * The app is the browser here: nothing may navigate the window, because the window
 * is the application. A page link has to open that page in the app, an external
 * one belongs in a real tab, and anything that resolves to neither must do nothing
 * at all — letting it through lands the whole app on a 404, or, behind a dev-server
 * port forward, on a blank "connecting…" page with no way back.
 */

export type LinkTarget =
  | { kind: 'page'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' }

/** An anchor as the DOM has it — either half may be missing. */
export interface LinkRef {
  id?: string | null
  href?: string | null
}

const EXTERNAL = /^(https?|mailto|tel):/i
/** In-page anchors and hrefs there is nothing sensible to do with. */
const INERT = /^(#|javascript:|data:|blob:|about:)/i

/**
 * Resolve a link against the vault. `data-aprinote` wins where it resolves — that is
 * the whole point of stable links — and a dangling id falls through to the
 * href it still carries, which is exactly the degraded case the file format is
 * designed for.
 */
export function linkTarget(link: LinkRef, fromPath: string, index: VaultIndex | null): LinkTarget {
  const id = link.id?.trim()
  if (id) {
    const path = index?.byId.get(id)
    if (path) return { kind: 'page', path }
  }

  const href = link.href?.trim() ?? ''
  if (!href || INERT.test(href)) return { kind: 'none' }
  if (EXTERNAL.test(href)) return { kind: 'external', url: href }
  // Protocol-relative, which resolves against the *app's* origin if left alone.
  if (href.startsWith('//')) return { kind: 'external', url: `https:${href}` }

  const path = toVaultPath(fromPath, href)
  if (!path) return { kind: 'none' }

  // A folder href is a page when the folder has an index page — the one shape
  // `relativeHref` never writes, but a hand-written link may well use.
  const candidates = path.endsWith('/')
    ? [join(path.slice(0, -1), INDEX_PAGE)]
    : [path, join(path, INDEX_PAGE)]

  const found = candidates.find((candidate) => index?.pages.has(candidate))
  return found ? { kind: 'page', path: found } : { kind: 'none' }
}

/**
 * Act on a resolved target. A `none` is deliberately silent — the click is spent.
 *
 * External links leave the app, and how they leave it is the one thing that
 * differs between the builds. In a tab, a new tab. In the native app the window
 * *is* the application, and `window.open` either opens a second chrome-less app
 * window or — on Android — does nothing at all, so the link goes to the system
 * browser instead.
 */
export function follow(target: LinkTarget): void {
  if (target.kind === 'page') return void useVault.getState().openPage(target.path)
  if (target.kind !== 'external') return

  if (isNative()) void openExternal(target.url)
  else window.open(target.url, '_blank', 'noopener,noreferrer')
}

/** Resolve against the open page and act, for the two surfaces that show links. */
export function followLink(link: LinkRef): void {
  const { page, index } = useVault.getState()
  follow(linkTarget(link, page?.meta.path ?? '', index))
}
