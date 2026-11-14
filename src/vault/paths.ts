/** Vault paths are POSIX, relative to the vault root, with no leading slash. Root is ''. */

export const ASSETS_DIR = '_assets'
export const VAULT_DIR = '_vault'
export const SITE_CSS = `${VAULT_DIR}/site.css`
export const VAULT_JSON = `${VAULT_DIR}/vault.json`
export const INDEX_PAGE = 'index.html'

/** `_assets/` and `_vault/` are storage, not pages — never shown in the tree. */
export function isReserved(path: string): boolean {
  const top = path.split('/')[0]
  return top === ASSETS_DIR || top === VAULT_DIR
}

export function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/')
}

export function dirname(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

export function basename(path: string): string {
  const at = path.lastIndexOf('/')
  return at === -1 ? path : path.slice(at + 1)
}

export function stem(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

export function isPage(path: string): boolean {
  return path.toLowerCase().endsWith('.html')
}

/** How many directories deep a path sits — `a/b/c.html` is 2. */
export function depthOf(path: string): number {
  const dir = dirname(path)
  return dir === '' ? 0 : dir.split('/').length
}

/** The `../` prefix that climbs from a page back to the vault root. */
export function upToRoot(fromPath: string): string {
  return '../'.repeat(depthOf(fromPath))
}

/**
 * A relative href from the directory holding `fromPath` to `toPath`. Always
 * emits a real filename, never a bare directory — a trailing-slash href is
 * prettier under a server but dead under `file://`.
 */
export function relativeHref(fromPath: string, toPath: string): string {
  const from = dirname(fromPath).split('/').filter(Boolean)
  const to = toPath.split('/').filter(Boolean)

  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared++

  const up = '../'.repeat(from.length - shared)
  const down = to.slice(shared).join('/')
  return up + down || basename(toPath)
}

/** The `src` an asset should carry on a page at `fromPath`. */
export function assetSrc(fromPath: string, assetName: string): string {
  return upToRoot(fromPath) + join(ASSETS_DIR, assetName)
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'untitled'
}

/**
 * Directory names stay slugged on disk — the vault is a website, and a folder with
 * spaces in it needs percent-encoding in every href. So `design-system` is what
 * lands on disk and `Design system` is what the sidebar shows. A folder holding an
 * index page uses that page's real title instead.
 */
export function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `report.html` → `report-1.html` → `report-2.html`, skipping what already exists. */
export function uniquePath(path: string, taken: (candidate: string) => boolean): string {
  if (!taken(path)) return path
  const dir = dirname(path)
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  const ext = dot <= 0 ? '' : name.slice(dot)

  for (let n = 1; ; n++) {
    const candidate = join(dir, `${base}-${n}${ext}`)
    if (!taken(candidate)) return candidate
  }
}
