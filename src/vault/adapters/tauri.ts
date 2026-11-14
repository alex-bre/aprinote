import { invoke } from '@tauri-apps/api/core'
import { isNative } from '@/platform/native'
import type { AdapterId, Entry, Stat, VaultAdapter, VaultRef } from '../VaultAdapter'
import { assetMime } from '../assets'

/**
 * The native filesystem — real files, through Rust.
 *
 * Every method below is one `vault_*` command in `src-tauri/src/vault.rs`. The
 * root is held there, not here, so this adapter only ever sends vault-relative
 * paths and a webview cannot talk the app into reading `/etc/passwd`.
 *
 * Two things differ from the browser adapters, and both come from Android:
 *
 * * **There is no folder picker on Android.** Tauri's dialog plugin has none,
 *   because the only Android directory picker returns a SAF tree URI that
 *   cannot be listed or written into as a path. So `pick()` opens the default
 *   vault directly on mobile, and `openAt()` is how the user names another one.
 * * **A path can be refused rather than missing.** Shared storage needs the
 *   "All files access" permission, so `probe()` exists to ask before opening,
 *   and the gate explains the refusal instead of just failing.
 *
 * Nothing lapses here the way an FSA grant does — a native app keeps its access
 * — so a vault only comes back `connected: false` when its folder has actually
 * gone away or turned unwritable.
 */

/** The remembered root. A plain path, so `localStorage` is enough. */
const ROOT_KEY = 'aprinote.native.root'
/** The pre-rename key; still read, so an installed app reopens its vault. */
const LEGACY_ROOT_KEY = 'leaf.native.root'

export interface NativeEnv {
  os: string
  mobile: boolean
  canPickFolder: boolean
  /** Where a vault goes when the user does not choose one. */
  defaultRoot: string
  /** False on Android until "All files access" is granted. */
  canUseAnyPath: boolean
}

export interface PathProbe {
  exists: boolean
  usable: boolean
  note: string | null
}

interface Opened {
  root: string
  name: string
}

class TauriAdapter implements VaultAdapter {
  readonly id: AdapterId = 'tauri'
  readonly label = 'Local folder'

  private env: NativeEnv | null = null
  private root: string | null = null

  available(): boolean {
    return isNative()
  }

  /** Cached: the answer is fixed for the life of the process. */
  async environment(): Promise<NativeEnv> {
    this.env ??= await invoke<NativeEnv>('vault_env')
    return this.env
  }

  /**
   * `canUseAnyPath`, asked again rather than read from the cached environment:
   * it turns true while the app runs, once the user grants "All files access".
   */
  anyPathAccess(): Promise<boolean> {
    return invoke<boolean>('vault_any_path')
  }

  /**
   * Open Android's "All files access" screen for aprinote. Resolves once the
   * screen is up, not once the user has chosen — ask `anyPathAccess()` again
   * when the app is back in the foreground.
   */
  grantAnyPathAccess(): Promise<void> {
    return invoke<void>('vault_grant_any_path')
  }

  /** Can a vault live here? Asked by the gate's path field before opening. */
  probe(path: string): Promise<PathProbe> {
    return invoke<PathProbe>('vault_probe', { path })
  }

  /**
   * Desktop opens the native folder picker; mobile has none, so it opens the
   * default vault — which is the app's own documents directory, and needs no
   * permission. `openAt` is the way to anywhere else.
   */
  async pick(): Promise<VaultRef | null> {
    const env = await this.environment()
    const path = env.canPickFolder ? await invoke<string | null>('vault_pick') : env.defaultRoot
    return path ? this.openAt(path) : null
  }

  /** Open — creating it if needed — the vault at an absolute path. */
  async openAt(path: string): Promise<VaultRef> {
    const opened = await invoke<Opened>('vault_open', { path })
    this.root = opened.root
    remember(opened.root)
    return { adapterId: this.id, name: opened.name, connected: true }
  }

  async restore(): Promise<VaultRef | null> {
    const path = remembered()
    if (!path) return null
    try {
      return await this.openAt(path)
    } catch {
      // The folder is gone, or on Android the permission that reached it was
      // revoked. Either way the gate's reconnect button is the right next step,
      // so report it as a lapse rather than an error — and keep the name, which
      // is the last path segment.
      this.root = path
      return { adapterId: this.id, name: folderName(path), connected: false }
    }
  }

  async reconnect(): Promise<VaultRef | null> {
    const path = this.root ?? remembered()
    return path ? this.openAt(path) : this.pick()
  }

  async forget(): Promise<void> {
    this.root = null
    try {
      localStorage.removeItem(ROOT_KEY)
      localStorage.removeItem(LEGACY_ROOT_KEY)
    } catch {
      // Nothing to clear.
    }
    await invoke('vault_close')
  }

  list(dir: string): Promise<Entry[]> {
    return invoke<Entry[]>('vault_list', { dir })
  }

  read(path: string): Promise<string> {
    return invoke<string>('vault_read', { path })
  }

  write(path: string, text: string): Promise<void> {
    return invoke<void>('vault_write', { path, text })
  }

  /**
   * The command answers on the raw IPC channel, so this is an ArrayBuffer and
   * not a JSON array of 2 million numbers. The type comes from the extension,
   * as it does in the handle adapters: a typeless blob becomes a blob URL that
   * Firefox and some webviews decline to render as an image.
   */
  async readBinary(path: string): Promise<Blob> {
    const bytes = await invoke<ArrayBuffer>('vault_read_binary', { path })
    const mime = assetMime(path)
    return new Blob([bytes], mime ? { type: mime } : undefined)
  }

  /** Base64 up, raw bytes down — see the command's comment for why. */
  async writeBinary(path: string, data: Blob): Promise<void> {
    await invoke<void>('vault_write_binary', {
      path,
      data: toBase64(new Uint8Array(await data.arrayBuffer())),
    })
  }

  move(from: string, to: string): Promise<void> {
    return invoke<void>('vault_move', { from, to })
  }

  remove(path: string): Promise<void> {
    return invoke<void>('vault_remove', { path })
  }

  mkdir(path: string): Promise<void> {
    return invoke<void>('vault_mkdir', { path })
  }

  exists(path: string): Promise<boolean> {
    return invoke<boolean>('vault_exists', { path })
  }

  stat(path: string): Promise<Stat | null> {
    return invoke<Stat | null>('vault_stat', { path })
  }
}

/** The last segment of a path, with Windows separators counting too. */
function folderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function remembered(): string | null {
  try {
    return localStorage.getItem(ROOT_KEY) ?? localStorage.getItem(LEGACY_ROOT_KEY)
  } catch {
    return null
  }
}

function remember(root: string): void {
  try {
    localStorage.setItem(ROOT_KEY, root)
  } catch {
    // The vault just won't reopen itself on next launch.
  }
}

/**
 * Chunked rather than `btoa(String.fromCharCode(...bytes))`: spreading a
 * multi-megabyte image into an argument list blows the call stack, and a
 * dropped photo is exactly that size.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

export const tauriAdapter = new TauriAdapter()
