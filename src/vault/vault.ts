import defaultSiteCss from '@/styles/doc.css?raw'
import { StaleWriteError, type VaultAdapter } from './VaultAdapter'
import { rewriteAssetDepth } from './assets'
import { upgradeLegacyCss } from './format'
import { retitleLinks, rewritePageLinks } from './links'
import { createPage, newPageId, pageIdIn, retitle, serializePage } from './page'
import {
  ASSETS_DIR,
  INDEX_PAGE,
  SITE_CSS,
  VAULT_JSON,
  basename,
  dirname,
  humanize,
  assetSrc,
  join,
  slugify,
  stem,
  uniquePath,
} from './paths'
import { scanVault, type VaultIndex } from './tree'

import { DEFAULT_SETTINGS, type VaultSettings } from './palette'

const DEFAULT_VAULT_JSON = DEFAULT_SETTINGS

/** Vault settings, falling back to the defaults for anything missing or corrupt. */
export async function readSettings(adapter: VaultAdapter): Promise<VaultSettings> {
  try {
    const stored = JSON.parse(await adapter.read(VAULT_JSON)) as Partial<VaultSettings>
    return {
      version: stored.version ?? DEFAULT_SETTINGS.version,
      palette: {
        text: stored.palette?.text ?? DEFAULT_SETTINGS.palette.text,
        background: stored.palette?.background ?? DEFAULT_SETTINGS.palette.background,
      },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export async function writeSettings(
  adapter: VaultAdapter,
  settings: VaultSettings,
): Promise<void> {
  await adapter.write(VAULT_JSON, `${JSON.stringify(settings, null, 2)}\n`)
}

/** Filenames in the vault's one global `_assets/` directory. */
export async function listAssets(adapter: VaultAdapter): Promise<string[]> {
  if (!(await adapter.exists(ASSETS_DIR))) return []
  const entries = await adapter.list(ASSETS_DIR)
  return entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name)
}

/**
 * Give a folder the files that make it a vault. Both are written only when
 * missing, so pointing the app at an existing directory of HTML never overwrites
 * anything the user already has.
 *
 * The one exception is a `site.css` from before the rename: its `leaf`
 * selectors are renamed in place (and nothing else in it changes), since pages
 * are rewritten in the new names as they are saved (see `format.ts`).
 */
export async function initVault(adapter: VaultAdapter): Promise<void> {
  if (!(await adapter.exists(SITE_CSS))) {
    await adapter.write(SITE_CSS, defaultSiteCss)
  } else {
    const css = await adapter.read(SITE_CSS)
    const upgraded = upgradeLegacyCss(css)
    if (upgraded !== css) await adapter.write(SITE_CSS, upgraded)
  }
  if (!(await adapter.exists(VAULT_JSON))) {
    await adapter.write(VAULT_JSON, `${JSON.stringify(DEFAULT_VAULT_JSON, null, 2)}\n`)
  }
}

export function rescan(adapter: VaultAdapter): Promise<VaultIndex> {
  return scanVault(adapter)
}

/**
 * Save an edited fragment back into its document, preserving everything else.
 *
 * `base` is the document the caller is holding — the last known file contents. It
 * is spliced into rather than re-read, which is what lets the full-file source view
 * share this path: there the caller has already rewritten the head, and the
 * fragment it passes is the one parsed back out of it.
 */
export async function savePage(
  adapter: VaultAdapter,
  path: string,
  fragment: string,
  expectedMtime: number | null,
  base?: string,
): Promise<{ mtime: number; id: string }> {
  const current = await adapter.stat(path)
  if (expectedMtime !== null && current && current.lastModified > expectedMtime) {
    throw new StaleWriteError(path)
  }

  const original = base ?? (await adapter.read(path))
  const id = pageIdIn(original) || newPageId()
  await adapter.write(path, serializePage(original, fragment, { id }))

  const after = await adapter.stat(path)
  return { mtime: after?.lastModified ?? Date.now(), id }
}

/**
 * Store a dropped or pasted image in the vault's one global `_assets/` directory
 * and return the `src` for a page at `pagePath` — depth-relative. Names
 * are derived from the file so they stay readable; collisions get a `-1` suffix.
 */
export async function writeAsset(
  adapter: VaultAdapter,
  file: File,
  pagePath: string,
): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const base = slugify(dot > 0 ? file.name.slice(0, dot) : file.name)
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : ''

  const path = await freePath(adapter, join(ASSETS_DIR, `${base}${extension}`))
  await adapter.writeBinary(path, file)
  return assetSrc(pagePath, basename(path))
}

export async function newPage(
  adapter: VaultAdapter,
  dir: string,
  title = 'Untitled',
): Promise<string> {
  const path = await freePath(adapter, join(dir, `${slugify(title)}.html`))
  await adapter.write(path, createPage(path, title))
  return path
}

export async function newFolder(adapter: VaultAdapter, dir: string, name: string): Promise<string> {
  const path = await freePath(adapter, join(dir, slugify(name)))
  await adapter.mkdir(path)
  return path
}

/** Turn a plain container into a folder that *is* a page. */
export async function addIndexPage(adapter: VaultAdapter, folder: string): Promise<string> {
  const path = join(folder, INDEX_PAGE)
  if (await adapter.exists(path)) return path
  const title = humanize(basename(folder))
  await adapter.write(path, createPage(path, title))
  return path
}

/**
 * Rewrite the `href` of every *inbound* link after a page moved or was renamed.
 *
 * The moved page's own outgoing links are handled where it is written; this is the
 * other half — the pages pointing *at* it, found through the backlink index. One
 * batch, so a rename is a single logical change.
 */
export async function rewriteInbound(
  adapter: VaultAdapter,
  index: VaultIndex,
  targetId: string,
  newPath: string,
  renamed?: { from: string; to: string },
): Promise<void> {
  const sources = index.backlinks.get(targetId) ?? []
  const resolve = (id: string) => (id === targetId ? newPath : index.byId.get(id))

  for (const source of sources) {
    // The page may itself have just moved as part of the same operation.
    const path = source.path === index.byId.get(targetId) ? newPath : source.path
    if (!(await adapter.exists(path))) continue

    const original = await adapter.read(path)
    let rewritten = rewritePageLinks(original, path, resolve)
    if (renamed) rewritten = retitleLinks(rewritten, targetId, renamed.from, renamed.to)
    if (rewritten !== original) await adapter.write(path, rewritten)
  }
}

export async function renamePage(
  adapter: VaultAdapter,
  path: string,
  title: string,
  index?: VaultIndex,
): Promise<string> {
  const original = await adapter.read(path)
  const previous = /<title>([\s\S]*?)<\/title>/i.exec(original)?.[1]?.trim() ?? ''
  const retitled = retitle(original, previous, title)
  const id = index?.pages.get(path)?.id

  // An index page is its folder's row, so retitling it must not rename the file —
  // that would move the whole folder.
  if (basename(path) === INDEX_PAGE) {
    await adapter.write(path, retitled)
    if (index && id) await rewriteInbound(adapter, index, id, path, { from: previous, to: title })
    return path
  }

  const target = await freePath(adapter, join(dirname(path), `${slugify(title)}.html`), path)
  await adapter.write(path, retitled)
  if (target !== path) await adapter.move(path, target)
  if (index && id) await rewriteInbound(adapter, index, id, target, { from: previous, to: title })
  return target
}

export async function renameFolder(
  adapter: VaultAdapter,
  path: string,
  name: string,
): Promise<string> {
  const target = await freePath(adapter, join(dirname(path), slugify(name)), path)
  if (target === path) return path
  await moveTree(adapter, path, target)
  return target
}

export async function removeEntry(adapter: VaultAdapter, path: string): Promise<void> {
  // Deleting a page never deletes assets: any image may be referenced anywhere.
  await adapter.remove(path)
}

/**
 * Move a page into another folder. Because depth is baked into every `_assets/`
 * reference, this is a transaction: relocate the file, recompute the `../` depth,
 * and recompute the page's own stable-link hrefs — all in one write.
 */
export async function movePage(
  adapter: VaultAdapter,
  from: string,
  toDir: string,
  index: VaultIndex,
): Promise<string> {
  const to = await freePath(adapter, join(toDir, basename(from)), from)
  if (to === from) return from

  const original = await adapter.read(from)
  const resolve = (id: string) => {
    const target = index.byId.get(id)
    return target === from ? to : target
  }
  const rewritten = rewritePageLinks(rewriteAssetDepth(original, from, to), to, resolve)

  await adapter.write(to, rewritten)
  await adapter.remove(from)

  const id = index.pages.get(from)?.id
  if (id) await rewriteInbound(adapter, index, id, to)
  return to
}

/** Move a folder and everything under it, fixing every contained page's depth. */
export async function moveFolder(
  adapter: VaultAdapter,
  from: string,
  toDir: string,
  index: VaultIndex,
): Promise<string> {
  const to = await freePath(adapter, join(toDir, basename(from)), from)
  if (to === from || to.startsWith(`${from}/`)) return from

  const moved = [...index.pages].filter(([path]) => path === from || path.startsWith(`${from}/`))
  await moveTree(adapter, from, to, index)

  for (const [path, meta] of moved) {
    await rewriteInbound(adapter, index, meta.id, to + path.slice(from.length))
  }
  return to
}

async function moveTree(
  adapter: VaultAdapter,
  from: string,
  to: string,
  index?: VaultIndex,
): Promise<void> {
  // Explicitly, before the walk: a folder with nothing in it has no entry to
  // recreate it at the destination, and would otherwise vanish on a rename.
  await adapter.mkdir(to)
  for (const entry of await adapter.list(from)) {
    const target = join(to, entry.name)
    if (entry.kind === 'directory') {
      await moveTree(adapter, entry.path, target, index)
      continue
    }
    if (entry.path.toLowerCase().endsWith('.html')) {
      const original = await adapter.read(entry.path)
      const resolve = (id: string) => index?.byId.get(id)
      const rewritten = rewritePageLinks(rewriteAssetDepth(original, entry.path, target), target, resolve)
      await adapter.write(target, rewritten)
      await adapter.remove(entry.path)
    } else {
      await adapter.move(entry.path, target)
    }
  }
  await adapter.remove(from)
}

/** First free variant of `path`, ignoring a path the caller already owns. */
async function freePath(adapter: VaultAdapter, path: string, own?: string): Promise<string> {
  const taken = new Set<string>()
  let candidate = path

  for (let guard = 0; guard < 100; guard++) {
    candidate = uniquePath(path, (option) => taken.has(option))
    if (candidate === own || !(await adapter.exists(candidate))) return candidate
    taken.add(candidate)
  }
  return join(dirname(path), `${stem(path)}-${Date.now()}.html`)
}
