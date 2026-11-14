import { ASSETS_DIR, VAULT_DIR, basename, depthOf, upToRoot } from './paths'

/**
 * Depth is baked into every `src`, so moving a page between folders invalidates
 * its image references. Move is therefore a transaction: relocate the file,
 * recompute the `../` depth, and rewrite every reference in the page.
 *
 * Get this wrong and images break silently on reorganisation, which is the single
 * most likely way to lose trust in the app — hence the test suite around it.
 */

/**
 * Any src/href pointing into a vault-root directory, however many `../` deep.
 *
 * `_vault/` belongs here as much as `_assets/` does: every page links its
 * stylesheet as `../_vault/site.css`, so a page that moves without this being
 * recomputed renders unstyled the moment it is opened off disk.
 */
const ROOT_REF = new RegExp(
  `((?:src|href)\\s*=\\s*["'])((?:\\.\\./)*)((?:${ASSETS_DIR}|${VAULT_DIR})/[^"']*)(["'])`,
  'gi',
)

/**
 * The media type of an asset, by extension.
 *
 * Derived from the name rather than read from the blob: an adapter hands back
 * whatever type the backend felt like — the in-browser vault and the in-memory one
 * often hand back none at all — and a typeless image is an image that will not
 * render once it leaves the app's own origin as a data URI (preview).
 */
const MIME: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'video/ogg',
  wav: 'audio/wav',
  webm: 'video/webm',
}

export function assetMime(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 && MIME[name.slice(dot + 1).toLowerCase()]) || ''
}

/**
 * A page-relative reference decoded back to the filename on disk — `%20` is a
 * space in the href and a space in the directory.
 */
export function assetName(reference: string): string {
  const name = basename(reference.split(/[?#]/)[0])
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

/** Every asset filename a page references. */
export function assetsReferencedBy(html: string): string[] {
  const names = new Set<string>()
  for (const [, , , target] of html.matchAll(ROOT_REF)) {
    if (target.startsWith(`${ASSETS_DIR}/`)) names.add(assetName(target))
  }
  return [...names]
}

/**
 * Rewrite `_assets/` references for a page that moved from `fromPath` to `toPath`.
 * Depth is recomputed from scratch rather than patched, so a page that was already
 * wrong lands correct.
 */
export function rewriteAssetDepth(html: string, fromPath: string, toPath: string): string {
  if (depthOf(fromPath) === depthOf(toPath)) return html
  const prefix = upToRoot(toPath)
  return html.replace(ROOT_REF, (_match, attr, _up, target, quote) => `${attr}${prefix}${target}${quote}`)
}

/**
 * Point every `_assets/` reference at a URL the caller supplies, keyed by filename.
 *
 * This is how the preview frame gets its images. It is sandboxed without
 * `allow-same-origin`, so it has no origin of its own: a page-relative `src`
 * resolves against the *app's* URL to nothing, and a blob URL made by the app is
 * unreadable in there. Data URIs are the one form that crosses, so preview hands
 * this the bytes it read.
 *
 * A name with no URL behind it gets `fallback` — a reference the caller cannot
 * satisfy must still not become a request the frame will only fail to make.
 */
const ASSET_SRC = new RegExp(`(\\ssrc\\s*=\\s*["'])((?:\\.\\./)*${ASSETS_DIR}/[^"']+)(["'])`, 'gi')

export function inlineAssets(
  html: string,
  urls: Record<string, string>,
  fallback = '',
): string {
  return html.replace(
    ASSET_SRC,
    (whole: string, before: string, reference: string, after: string) => {
      const url = urls[assetName(reference)] || fallback
      return url ? `${before}${url}${after}` : whole
    },
  )
}
