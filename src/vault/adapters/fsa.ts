import type { AdapterId, VaultAdapter, VaultRef } from '../VaultAdapter'
import { HandleFileSystem } from './handleFs'
import { deleteGrant, getGrant, putGrant } from './idb'

const GRANT_KEY = 'vault-directory'

/**
 * File System Access API — real files in a real folder, Chromium only.
 *
 * The directory handle survives in IndexedDB so the vault reopens across
 * sessions, but the permission grant does not: a lapsed grant comes back as
 * `connected: false`, and re-requesting it needs a user gesture.
 */
class FsaAdapter extends HandleFileSystem implements VaultAdapter {
  readonly id: AdapterId = 'fsa'
  readonly label = 'Local folder'

  available(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  }

  async pick(): Promise<VaultRef | null> {
    let handle: FileSystemDirectoryHandle
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'aprinote-vault' })
    } catch {
      return null // the user dismissed the picker
    }
    this.root = handle
    await putGrant(GRANT_KEY, handle)
    return { adapterId: this.id, name: handle.name, connected: true }
  }

  async restore(): Promise<VaultRef | null> {
    const handle = await getGrant<FileSystemDirectoryHandle>(GRANT_KEY)
    if (!handle) return null
    this.root = handle
    const state = await handle.queryPermission({ mode: 'readwrite' })
    return { adapterId: this.id, name: handle.name, connected: state === 'granted' }
  }

  async reconnect(): Promise<VaultRef | null> {
    const handle = this.root ?? (await getGrant<FileSystemDirectoryHandle>(GRANT_KEY))
    if (!handle) return null
    this.root = handle
    const state = await handle.requestPermission({ mode: 'readwrite' })
    return { adapterId: this.id, name: handle.name, connected: state === 'granted' }
  }

  async forget(): Promise<void> {
    this.root = null
    await deleteGrant(GRANT_KEY)
  }
}

export const fsaAdapter = new FsaAdapter()
