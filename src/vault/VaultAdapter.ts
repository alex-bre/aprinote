/**
 * The filesystem port. Everything the app does to disk goes through this.
 *
 * The portability rule lives or dies here: no module outside
 * `src/vault/adapters/` may reference `showDirectoryPicker`, `FileSystemHandle`
 * or any browser storage API. That is what made the Tauri port a new adapter
 * file (`adapters/tauri.ts`) rather than a rewrite.
 */

export type AdapterId = 'tauri' | 'fsa' | 'opfs' | 'memory'

export interface Entry {
  name: string
  /** Vault-relative path. */
  path: string
  kind: 'file' | 'directory'
}

export interface Stat {
  lastModified: number
  size: number
}

/** A vault the user has granted access to. */
export interface VaultRef {
  adapterId: AdapterId
  /** Display name — the chosen directory's name, or a label for virtual vaults. */
  name: string
  /** False when the grant lapsed and a user gesture is needed to re-request it. */
  connected: boolean
}

export interface VaultAdapter {
  readonly id: AdapterId
  readonly label: string

  /** Whether this adapter can run in the current browser. */
  available(): boolean

  /** Prompt for a vault. Must be called from a user gesture. Null if cancelled. */
  pick(): Promise<VaultRef | null>

  /** Re-open the last vault without prompting. Null if there is nothing to restore. */
  restore(): Promise<VaultRef | null>

  /** Re-request a lapsed permission grant. Must be called from a user gesture. */
  reconnect(): Promise<VaultRef | null>

  /** Forget the persisted grant. */
  forget(): Promise<void>

  list(dir: string): Promise<Entry[]>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  readBinary(path: string): Promise<Blob>
  writeBinary(path: string, data: Blob): Promise<void>
  move(from: string, to: string): Promise<void>
  remove(path: string): Promise<void>
  mkdir(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<Stat | null>
}

/** Thrown when a write would clobber a change made outside the app. */
export class StaleWriteError extends Error {
  constructor(readonly path: string) {
    super(`${path} changed on disk since it was read`)
    this.name = 'StaleWriteError'
  }
}
