import type { VaultAdapter } from './VaultAdapter'
import type { FolderNode, PageMeta, TreeNode } from './types'
import { assetsReferencedBy } from './assets'
import { buildBacklinks, linksIn, type Backlink, type OutgoingLink } from './links'
import { parsePage } from './page'
import { INDEX_PAGE, basename, humanize, isPage, isReserved, stem } from './paths'

export interface VaultIndex {
  tree: TreeNode[]
  /** Every page in the vault, keyed by path. */
  pages: Map<string, PageMeta>
  /** id → path. Rebuildable from a full scan; never authoritative. */
  byId: Map<string, string>
  /** path → the stable links that page makes. */
  outgoing: Map<string, OutgoingLink[]>
  /** target id → the pages linking to it. */
  backlinks: Map<string, Backlink[]>
  /** path → the page's plain text, for full-text search. */
  text: Map<string, string>
  /** Every `_assets/` filename any page references, for the orphan sweep. */
  assetRefs: Set<string>
  pageCount: number
}

/**
 * How much of a page is kept for searching. Long enough to find anything a note
 * actually says, short enough that a large vault's index stays in memory.
 */
const SEARCH_CHARS = 20_000

/** Markup out, words in — what search matches against. */
export function plainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SEARCH_CHARS)
}

/**
 * Walk the vault into a tree. `_assets/` and `_vault/` are storage, not pages, so
 * they never appear; a folder holding `index.html` absorbs that page into its own
 * row rather than showing it as a child.
 */
export async function scanVault(adapter: VaultAdapter): Promise<VaultIndex> {
  const pages = new Map<string, PageMeta>()
  const byId = new Map<string, string>()
  const outgoing = new Map<string, OutgoingLink[]>()
  const text = new Map<string, string>()
  const assetRefs = new Set<string>()

  async function readMeta(path: string): Promise<PageMeta> {
    let meta: PageMeta
    try {
      // One read serves both: the page's identity and the links it makes.
      const html = await adapter.read(path)
      const parsed = parsePage(html, path)
      meta = parsed.meta
      const links = linksIn(html)
      if (links.length) outgoing.set(path, links)
      text.set(path, plainText(parsed.fragment))
      for (const name of assetsReferencedBy(html)) assetRefs.add(name)
    } catch {
      meta = { id: '', path, title: stem(path), editedAt: '' }
    }
    if (!meta.title) meta.title = stem(path)
    // A hand-made page carries no aprinote-id until the app first saves it; key it by
    // path meanwhile so links and selection still work.
    if (!meta.id) meta.id = `path:${path}`
    pages.set(path, meta)
    byId.set(meta.id, path)
    return meta
  }

  async function walk(dir: string): Promise<{ nodes: TreeNode[]; count: number }> {
    const entries = (await adapter.list(dir)).filter((entry) => !isReserved(entry.path))
    const folders: FolderNode[] = []
    const leaves: TreeNode[] = []
    let count = 0

    for (const entry of entries.filter((e) => e.kind === 'directory')) {
      const child = await walk(entry.path)
      const indexPath = `${entry.path}/${INDEX_PAGE}`
      const hasIndex = await adapter.exists(indexPath)
      const folder: FolderNode = {
        kind: 'folder',
        name: humanize(entry.name),
        path: entry.path,
        count: child.count,
        children: child.nodes,
      }
      if (hasIndex) folder.page = await readMeta(indexPath)
      folders.push(folder)
      count += child.count + (hasIndex ? 1 : 0)
    }

    for (const entry of entries.filter((e) => e.kind === 'file' && isPage(e.path))) {
      // The folder row *is* the index page — it must not also appear as a child.
      if (dir !== '' && basename(entry.path) === INDEX_PAGE) continue
      leaves.push({ kind: 'page', page: await readMeta(entry.path) })
      count++
    }

    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)
    folders.sort(byName)
    leaves.sort((a, b) =>
      a.kind === 'page' && b.kind === 'page' ? a.page.title.localeCompare(b.page.title) : 0,
    )

    return { nodes: [...folders, ...leaves], count }
  }

  const root = await walk('')
  return {
    tree: root.nodes,
    pages,
    byId,
    outgoing,
    backlinks: buildBacklinks(outgoing, pages, byId),
    text,
    assetRefs,
    pageCount: root.count,
  }
}

/** Display names for the ancestor folders of a page path. */
export function breadcrumbFor(path: string, tree: TreeNode[]): string[] {
  const segments = path.split('/').slice(0, -1)
  const names: string[] = []
  let level = tree

  for (const segment of segments) {
    const folder = level.find(
      (node): node is FolderNode => node.kind === 'folder' && basename(node.path) === segment,
    )
    names.push(folder?.name ?? segment)
    level = folder?.children ?? []
  }
  return names
}

/** Every folder path in the tree, for move targets and menus. */
export function foldersIn(tree: TreeNode[], into: string[] = []): string[] {
  for (const node of tree) {
    if (node.kind !== 'folder') continue
    into.push(node.path)
    foldersIn(node.children, into)
  }
  return into
}
