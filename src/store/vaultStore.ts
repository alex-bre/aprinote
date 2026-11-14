import { create } from 'zustand'
import { StaleWriteError, type VaultAdapter, type VaultRef } from '@/vault/VaultAdapter'
import { fsaAdapter } from '@/vault/adapters/fsa'
import { lastAdapter, rememberAdapter } from '@/vault/adapters/idb'
import { opfsAdapter } from '@/vault/adapters/opfs'
import { tauriAdapter } from '@/vault/adapters/tauri'
import { injectCss } from '@/vault/css'
import { parsePage, serializePage } from '@/vault/page'
import { DEFAULT_SETTINGS, type VaultSettings } from '@/vault/palette'
import { ASSETS_DIR, SITE_CSS, dirname, join } from '@/vault/paths'
import type { VaultIndex } from '@/vault/tree'
import type { PageMeta } from '@/vault/types'
import { unusedAssets } from '@/vault/search'
import * as ops from '@/vault/vault'

const AUTOSAVE_MS = 800

export type VaultStatus = 'closed' | 'opening' | 'ready' | 'disconnected' | 'error'
export type SaveState = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error'

/**
 * The vault stylesheet is the one document that is **not** autosaved. It is
 * applied on explicit save, so a half-written selector never repaints the document
 * under you mid-keystroke.
 */
export interface OpenStylesheet {
  text: string
  saved: string
}

export interface OpenPage {
  meta: PageMeta
  fragment: string
  pageStyle: string
  document: string
  mtime: number | null
}

/**
 * The backends worth trying, best first.
 *
 * In the Tauri build it is the only one: the app window is not a browser tab,
 * so a folder grant it cannot keep and an in-browser vault the user cannot see
 * are both the wrong answer — and the Android webview reports OPFS as available,
 * which would otherwise let a reload land in one.
 */
function candidates(): VaultAdapter[] {
  return tauriAdapter.available() ? [tauriAdapter] : [fsaAdapter, opfsAdapter]
}

/** Native where the app is native, FSA where it exists, OPFS otherwise. */
export function preferredAdapter(): VaultAdapter {
  return candidates().find((adapter) => adapter.available()) ?? opfsAdapter
}

/**
 * What the gate puts in front of the user. Adapters explain their own failures,
 * so the message is the readable half — `String(error)` would prepend the bare
 * DOM name ("SecurityError: Security error") and bury it.
 */
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Last adapter used first, so the choice between the two survives a reload. */
async function restoreOrder(): Promise<VaultAdapter[]> {
  const last = await lastAdapter()
  return candidates().sort((a, b) => Number(b.id === last) - Number(a.id === last))
}

interface VaultState {
  status: VaultStatus
  ref: VaultRef | null
  adapter: VaultAdapter | null
  index: VaultIndex | null
  page: OpenPage | null
  saveState: SaveState
  /** Raw `_vault/site.css`. Scoped and injected for the editor, raw for preview. */
  siteCss: string
  /** Non-null while the stylesheet is the open document instead of a page. */
  stylesheet: OpenStylesheet | null
  /** `_vault/vault.json` — the per-vault palette and settings. */
  settings: VaultSettings
  /** Bumped on every stylesheet save so open previews re-pull. */
  cssToken: number
  /**
   * Bumped when the fragment changed from outside the editor surface — a
   * full-file source edit — so the surface knows to reload rather than echo.
   */
  revision: number
  error: string | null

  restore: () => Promise<void>
  open: (adapter?: VaultAdapter) => Promise<void>
  /** Dev only: open the pre-filled demo vault. A no-op in a production build. */
  openDemo: () => Promise<void>
  reconnect: () => Promise<void>
  close: () => Promise<void>
  /**
   * Open the vault at an absolute path. Native builds only — it is how Android
   * reaches a folder, having no directory picker to offer (`adapters/tauri.ts`).
   */
  openAt: (path: string) => Promise<void>
  importFolder: (files: File[]) => Promise<void>

  openPage: (path: string) => Promise<void>
  openStylesheet: () => Promise<void>
  closeStylesheet: () => void
  editStylesheet: (text: string) => void
  saveStylesheet: () => Promise<void>
  /** Replace the whole document from the full-file source view. */
  editDocument: (text: string) => void
  reloadSiteCss: () => Promise<void>
  saveSettings: (settings: VaultSettings) => Promise<void>
  /** Assets no page references any more. Offered, never swept automatically. */
  findUnusedAssets: () => Promise<string[]>
  deleteAssets: (names: string[]) => Promise<void>
  /** Rescan without disturbing the open page — after an asset lands, say. */
  refreshIndex: () => Promise<void>
  edit: (fragment: string) => void
  save: () => Promise<void>
  resolveConflict: (keep: 'disk' | 'mine') => Promise<void>

  createPage: (dir: string) => Promise<void>
  createFolder: (dir: string, name: string) => Promise<void>
  addIndexPage: (folder: string) => Promise<void>
  rename: (path: string, name: string, isFolder: boolean) => Promise<void>
  remove: (path: string) => Promise<void>
  /** Delete a whole sidebar selection, rescanning once at the end. */
  removeMany: (paths: string[]) => Promise<void>
  move: (path: string, toDir: string, isFolder: boolean) => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

export const useVault = create<VaultState>((set, get) => {
  /** Rescan and reconcile the open page against what is now on disk. */
  async function refresh(nextPath?: string) {
    const { adapter, page } = get()
    if (!adapter) return
    const index = await ops.rescan(adapter)
    set({ index })

    const path = nextPath ?? page?.meta.path
    if (path && index.pages.has(path)) await get().openPage(path)
    else if (path) set({ page: null, saveState: 'saved' })
  }

  async function connect(ref: VaultRef | null, adapter: VaultAdapter) {
    if (!ref) return set({ status: 'closed' })
    if (!ref.connected) return set({ status: 'disconnected', ref, adapter })

    await rememberAdapter(adapter.id)
    await ops.initVault(adapter)
    const index = await ops.rescan(adapter)
    set({
      status: 'ready',
      ref,
      adapter,
      index,
      settings: await ops.readSettings(adapter),
      error: null,
    })
    await get().reloadSiteCss()

    const first = index.pages.keys().next()
    if (!first.done) await get().openPage(first.value)
  }

  return {
    status: 'closed',
    ref: null,
    adapter: null,
    index: null,
    page: null,
    saveState: 'saved',
    siteCss: '',
    stylesheet: null,
    settings: DEFAULT_SETTINGS,
    cssToken: 0,
    revision: 0,
    error: null,

    async restore() {
      set({ status: 'opening' })
      // Before the real adapters: a dev session that was in the demo stays in it
      // across reloads, rather than being pulled back to whatever folder the
      // browser still holds a grant for.
      if (import.meta.env.DEV) {
        const { demoRequested } = await import('@/dev/demoVault')
        if (demoRequested()) return await get().openDemo()
      }

      let failure: string | null = null
      for (const adapter of await restoreOrder()) {
        if (!adapter.available()) continue
        try {
          const ref = await adapter.restore()
          if (ref) return await connect(ref, adapter)
        } catch (error) {
          // A backend the browser refuses must not strand the gate: keep the
          // reason, and let the other adapter — and the user's own buttons —
          // still get their turn.
          failure ??= message(error)
        }
      }
      set({ status: 'closed', error: failure })
    },

    async open(adapter = preferredAdapter()) {
      set({ status: 'opening' })
      try {
        await connect(await adapter.pick(), adapter)
      } catch (error) {
        set({ status: 'error', error: message(error) })
      }
    },

    /**
     * The whole body is inside the `DEV` branch so a production build folds it to
     * an empty function and the demo vault's pages are never bundled.
     */
    async openDemo() {
      if (import.meta.env.DEV) {
        set({ status: 'opening' })
        try {
          const demo = await import('@/dev/demoVault')
          demo.remember(true)
          await connect(await demo.demoAdapter.pick(), demo.demoAdapter)
          // Scan order opens the first page it reaches, which is the deepest
          // folder's; the demo wants its homepage.
          if (get().index?.pages.has(demo.DEMO_HOME)) await get().openPage(demo.DEMO_HOME)
        } catch (error) {
          set({ status: 'error', error: message(error) })
        }
      }
    },

    async reconnect() {
      const adapter = get().adapter ?? preferredAdapter()
      try {
        await connect(await adapter.reconnect(), adapter)
      } catch (error) {
        set({ status: 'error', error: message(error) })
      }
    },

    async openAt(path) {
      set({ status: 'opening' })
      try {
        await connect(await tauriAdapter.openAt(path), tauriAdapter)
      } catch (error) {
        set({ status: 'error', error: message(error) })
      }
    },

    async close() {
      await get().adapter?.forget()
      set({ status: 'closed', ref: null, adapter: null, index: null, page: null })
    },

    async importFolder(files) {
      set({ status: 'opening' })
      try {
        await opfsAdapter.importFolder(files)
        await connect(await opfsAdapter.restore(), opfsAdapter)
      } catch (error) {
        set({ status: 'error', error: message(error) })
      }
    },

    /**
     * Applied on save, not as you type — so this is called on vault open and
     * whenever site.css is written, never on a keystroke.
     */
    async reloadSiteCss() {
      const { adapter } = get()
      if (!adapter) return
      const siteCss = (await adapter.exists(SITE_CSS)) ? await adapter.read(SITE_CSS) : ''
      set({ siteCss })
      injectCss(document, siteCss, get().page?.pageStyle ?? '')
    },

    async saveSettings(settings) {
      const { adapter } = get()
      if (!adapter) return
      await ops.writeSettings(adapter, settings)
      set({ settings })
    },

    async findUnusedAssets() {
      const { adapter, index } = get()
      if (!adapter || !index) return []
      return unusedAssets(await ops.listAssets(adapter), index)
    },

    async deleteAssets(names) {
      const { adapter } = get()
      if (!adapter) return
      for (const name of names) await adapter.remove(join(ASSETS_DIR, name))
      await get().refreshIndex()
    },

    async refreshIndex() {
      const { adapter } = get()
      if (adapter) set({ index: await ops.rescan(adapter) })
    },

    async openStylesheet() {
      const { adapter } = get()
      if (!adapter) return
      const text = (await adapter.exists(SITE_CSS)) ? await adapter.read(SITE_CSS) : ''
      set({ stylesheet: { text, saved: text } })
    },

    closeStylesheet() {
      set({ stylesheet: null })
    },

    editStylesheet(text) {
      const { stylesheet } = get()
      if (!stylesheet || stylesheet.text === text) return
      set({ stylesheet: { ...stylesheet, text } })
    },

    /**
     * ⌘S. Writing is what applies the stylesheet: it re-injects into the editor
     * host and bumps the token every open preview keys off.
     */
    async saveStylesheet() {
      const { adapter, stylesheet } = get()
      if (!adapter || !stylesheet || stylesheet.text === stylesheet.saved) return

      set({ saveState: 'saving' })
      try {
        await adapter.write(SITE_CSS, stylesheet.text)
        set({
          stylesheet: { text: stylesheet.text, saved: stylesheet.text },
          saveState: 'saved',
          cssToken: get().cssToken + 1,
        })
        await get().reloadSiteCss()
      } catch (error) {
        set({ saveState: 'error', error: message(error) })
      }
    },

    editDocument(text) {
      const { page } = get()
      if (!page || text === page.document) return

      const parsed = parsePage(text, page.meta.path)
      set({
        page: { ...page, document: text, fragment: parsed.fragment, pageStyle: parsed.pageStyle },
        saveState: 'dirty',
        revision: get().revision + 1,
      })
      injectCss(document, get().siteCss, parsed.pageStyle)

      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void get().save(), AUTOSAVE_MS)
    },

    async openPage(path) {
      const { adapter } = get()
      if (!adapter) return
      clearTimeout(saveTimer)
      set({ stylesheet: null })
      const source = await adapter.read(path)
      const parsed = parsePage(source, path)
      const stat = await adapter.stat(path)
      set({
        page: { ...parsed, document: source, mtime: stat?.lastModified ?? null },
        saveState: 'saved',
      })
      // Page rules go in after site.css so they win.
      injectCss(document, get().siteCss, parsed.pageStyle)
    },

    edit(fragment) {
      const { page, saveState } = get()
      if (!page || fragment === page.fragment) return
      if (saveState === 'conflict') return

      // Splice straight away rather than at save time, so the full-file source
      // view and the preview always show the same document the WYSIWYG does.
      // `stamp: false` keeps aprinote-edited off the keystroke path.
      const document = serializePage(page.document, fragment, { stamp: false })
      set({ page: { ...page, fragment, document }, saveState: 'dirty' })
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void get().save(), AUTOSAVE_MS)
    },

    async save() {
      const { adapter, page, saveState } = get()
      if (!adapter || !page || saveState === 'saving' || saveState === 'conflict') return
      clearTimeout(saveTimer)
      set({ saveState: 'saving' })

      try {
        const { mtime } = await ops.savePage(
          adapter,
          page.meta.path,
          page.fragment,
          page.mtime,
          page.document,
        )
        const source = await adapter.read(page.meta.path)
        set({ page: { ...get().page!, document: source, mtime }, saveState: 'saved' })
      } catch (error) {
        if (error instanceof StaleWriteError) return set({ saveState: 'conflict' })
        set({ saveState: 'error', error: message(error) })
      }
    },

    async resolveConflict(keep) {
      const { adapter, page } = get()
      if (!adapter || !page) return
      if (keep === 'disk') {
        set({ saveState: 'saved' })
        return get().openPage(page.meta.path)
      }
      const stat = await adapter.stat(page.meta.path)
      set({ page: { ...page, mtime: stat?.lastModified ?? null }, saveState: 'dirty' })
      await get().save()
    },

    async createPage(dir) {
      const { adapter } = get()
      if (!adapter) return
      await refresh(await ops.newPage(adapter, dir))
    },

    async createFolder(dir, name) {
      const { adapter } = get()
      if (!adapter) return
      await ops.newFolder(adapter, dir, name)
      await refresh()
    },

    async addIndexPage(folder) {
      const { adapter } = get()
      if (!adapter) return
      await refresh(await ops.addIndexPage(adapter, folder))
    },

    async rename(path, name, isFolder) {
      const { adapter, index, page } = get()
      if (!adapter) return
      if (isFolder) {
        const to = await ops.renameFolder(adapter, path, name)
        const open = page?.meta.path
        await refresh(open?.startsWith(`${path}/`) ? open.replace(path, to) : open)
      } else {
        await refresh(await ops.renamePage(adapter, path, name, index ?? undefined))
      }
    },

    async remove(path) {
      await get().removeMany([path])
    },

    async removeMany(paths) {
      const { adapter, page } = get()
      if (!adapter || paths.length === 0) return
      for (const path of paths) await ops.removeEntry(adapter, path)
      const open = page?.meta.path
      const gone = !!open && paths.some((path) => open === path || open.startsWith(`${path}/`))
      await refresh(gone ? undefined : open)
      if (gone) set({ page: null })
    },

    async move(path, toDir, isFolder) {
      const { adapter, index, page } = get()
      if (!adapter || !index) return
      if (dirname(path) === toDir) return

      if (isFolder) {
        const to = await ops.moveFolder(adapter, path, toDir, index)
        const open = page?.meta.path
        await refresh(open?.startsWith(`${path}/`) ? open.replace(path, to) : open)
      } else {
        const to = await ops.movePage(adapter, path, toDir, index)
        await refresh(page?.meta.path === path ? to : page?.meta.path)
      }
    },
  }
})
