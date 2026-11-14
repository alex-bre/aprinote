import type { AdapterId, VaultAdapter, VaultRef } from '../VaultAdapter'
import { HandleFileSystem } from './handleFs'

const NAME_KEY = 'aprinote.opfs.name'
/** The pre-rename key; still read, so an existing vault keeps its name. */
const LEGACY_NAME_KEY = 'leaf.opfs.name'
const ROOT = 'vault'

/**
 * Browsers that have OPFS still refuse it in some contexts — a private window, a
 * page opened straight from disk, a profile with site data blocked — and the only
 * signal is a bare `SecurityError: Security error` from `getDirectory`. Nothing in
 * the app can undo that refusal, so the least it can do is say what it means.
 */
function refusalMessage(): string {
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    return (
      'This browser blocks in-browser storage on pages opened straight from disk (file://). ' +
      'Serve aprinote over http:// or https:// instead — `npm run preview` does that locally.'
    )
  }
  return (
    'This browser refused in-browser storage for this site. Private windows have no in-browser ' +
    'vault, and neither do sites whose cookies and site data are blocked — try a normal window, ' +
    'and allow site data for this origin.'
  )
}

async function storageRoot(): Promise<FileSystemDirectoryHandle> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error(
      'This browser has no in-browser file storage, so aprinote cannot hold a vault here.'
    )
  }
  try {
    return await navigator.storage.getDirectory()
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'SecurityError' || name === 'NotAllowedError') throw new Error(refusalMessage())
    throw error
  }
}

/**
 * Origin Private File System — the degraded mode for Firefox and Safari, which
 * have no File System Access API. Same file semantics, except the files live
 * inside the browser rather than in a folder the user can see, so notes get in
 * through `importFolder` rather than a picker.
 */
class OpfsAdapter extends HandleFileSystem implements VaultAdapter {
  readonly id: AdapterId = 'opfs'
  readonly label = 'In-browser vault'

  available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
  }

  private async mount(name: string): Promise<VaultRef> {
    const storage = await storageRoot()
    this.root = await storage.getDirectoryHandle(ROOT, { create: true })
    try {
      localStorage.setItem(NAME_KEY, name)
    } catch {
      // Name just won't survive a reload; the vault itself still will.
    }
    return { adapterId: this.id, name, connected: true }
  }

  /** There is nothing to pick — opening the in-browser vault creates it. */
  async pick(): Promise<VaultRef | null> {
    return this.mount(this.storedName() ?? 'Browser vault')
  }

  async restore(): Promise<VaultRef | null> {
    const name = this.storedName()
    return name ? this.mount(name) : null
  }

  async reconnect(): Promise<VaultRef | null> {
    return this.pick()
  }

  async forget(): Promise<void> {
    this.root = null
    try {
      localStorage.removeItem(NAME_KEY)
      localStorage.removeItem(LEGACY_NAME_KEY)
    } catch {
      // Nothing to clear.
    }
  }

  private storedName(): string | null {
    try {
      return localStorage.getItem(NAME_KEY) ?? localStorage.getItem(LEGACY_NAME_KEY)
    } catch {
      return null
    }
  }

  /**
   * Copy a folder the user selected with `<input webkitdirectory>` into the
   * vault. That input is the one folder-shaped affordance Firefox and Safari do
   * have, so it is how a real directory of notes gets in.
   */
  async importFolder(files: File[]): Promise<{ imported: number; name: string }> {
    if (files.length === 0) return { imported: 0, name: this.storedName() ?? 'Browser vault' }

    // webkitRelativePath is "<chosen folder>/a/b.html" — the vault starts below it.
    const name = files[0].webkitRelativePath.split('/')[0] || 'Imported vault'
    await this.mount(name)

    let imported = 0
    for (const file of files) {
      const path = file.webkitRelativePath.split('/').slice(1).join('/')
      if (!path) continue
      await this.writeBinary(path, file)
      imported++
    }
    return { imported, name }
  }
}

export const opfsAdapter = new OpfsAdapter()
