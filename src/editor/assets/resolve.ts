/**
 * Vault assets in the editing surface.
 *
 * A page carries `src="../_assets/map.png"`, which is correct on disk and correct
 * when the vault is opened in a browser — but inside the app the document lives on
 * the app's own origin, so that path resolves to nothing. Every image would be
 * broken in the one place you are editing it.
 *
 * So the canonical path moves to `data-aprinote-src` and `src` holds a blob URL for
 * the bytes read through the adapter. The pretty-printer writes `src` back from
 * `data-aprinote-src` (see `serialize.ts`), so what lands on disk is unchanged — the
 * swap is a display-layer concern that never reaches a file.
 */

export const CANONICAL_SRC = 'data-aprinote-src'

/** Reads a vault-relative path. Supplied by the app; the editor stays vault-agnostic. */
export type AssetReader = (path: string) => Promise<Blob | null>

/** Writes a file into `_assets/`, returning the page-relative `src` to use. */
export type AssetWriter = (file: File) => Promise<string>

export interface AssetPort {
  read: AssetReader
  write: AssetWriter
}

const REMOTE = /^(https?:|data:|blob:|#|mailto:)/i

/** Marks a figure as an embed card and carries the URL for the label. */
export const EMBED_LABEL = 'data-aprinote-embed'

/**
 * Make embeds genuinely inert while editing. Parking the `src` in
 * `data-aprinote-src` means the third-party frame is never fetched at all — not
 * merely covered — so a page full of embeds stays fast and cannot steal the
 * caret. The pretty-printer restores `src`, so preview and disk get the real
 * thing.
 */
export function deactivateEmbeds(root: ParentNode): void {
  for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe')) {
    const declared = frame.getAttribute(CANONICAL_SRC) ?? frame.getAttribute('src') ?? ''
    if (!declared) continue
    frame.setAttribute(CANONICAL_SRC, declared)
    frame.removeAttribute('src')
    ;(frame.closest('figure') ?? frame).setAttribute(EMBED_LABEL, declared)
  }
}

/** Turn a page-relative reference into a vault-relative path. */
export function toVaultPath(pagePath: string, src: string): string | null {
  if (!src || REMOTE.test(src)) return null
  try {
    const base = new URL(`https://vault.invalid/${pagePath}`)
    return decodeURIComponent(new URL(src, base).pathname.slice(1))
  } catch {
    return null
  }
}

function referencing(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('img[src], video[src], source[src]')]
}

/**
 * Point every local reference at a blob URL. Returns a revoke function — call it
 * when the page closes, or the URLs leak for the life of the tab.
 */
export async function resolveAssets(
  root: ParentNode,
  pagePath: string,
  read: AssetReader,
): Promise<() => void> {
  const urls: string[] = []

  deactivateEmbeds(root)

  await Promise.all(
    referencing(root).map(async (element) => {
      const declared = element.getAttribute(CANONICAL_SRC) ?? element.getAttribute('src') ?? ''
      const path = toVaultPath(pagePath, declared)
      if (!path) return

      const blob = await read(path).catch(() => null)
      element.setAttribute(CANONICAL_SRC, declared)
      if (!blob) {
        // Leave a marker rather than a silently broken image — a move that failed
        // to rewrite a src is exactly what this makes visible.
        element.setAttribute('data-aprinote-missing', '')
        element.removeAttribute('src')
        return
      }

      element.removeAttribute('data-aprinote-missing')
      const url = URL.createObjectURL(blob)
      urls.push(url)
      element.setAttribute('src', url)
    }),
  )

  return () => urls.forEach(URL.revokeObjectURL)
}

/** Resolve one freshly inserted element, so a dropped image appears immediately. */
export async function resolveOne(
  element: HTMLElement,
  pagePath: string,
  read: AssetReader,
): Promise<string | null> {
  const declared = element.getAttribute(CANONICAL_SRC) ?? element.getAttribute('src') ?? ''
  const path = toVaultPath(pagePath, declared)
  if (!path) return null

  const blob = await read(path).catch(() => null)
  if (!blob) return null

  const url = URL.createObjectURL(blob)
  element.setAttribute(CANONICAL_SRC, declared)
  element.setAttribute('src', url)
  return url
}
