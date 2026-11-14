import type { AdapterId, Entry, Stat, VaultAdapter, VaultRef } from '../VaultAdapter'
import { dirname } from '../paths'

/** In-memory vault. Backs the test suite; never selected by the running app. */
class MemoryAdapter implements VaultAdapter {
  readonly id: AdapterId = 'memory'
  // Typed rather than inferred: the dev demo vault subclasses this and renames it.
  readonly label: string = 'In-memory vault'

  private files = new Map<string, { data: Blob; lastModified: number }>()
  private dirs = new Set<string>()
  private open = false

  available(): boolean {
    return true
  }

  async pick(): Promise<VaultRef | null> {
    this.open = true
    return { adapterId: this.id, name: 'Memory vault', connected: true }
  }

  async restore(): Promise<VaultRef | null> {
    return this.open ? { adapterId: this.id, name: 'Memory vault', connected: true } : null
  }

  async reconnect(): Promise<VaultRef | null> {
    return this.pick()
  }

  async forget(): Promise<void> {
    this.open = false
  }

  /** Test helper: wipe and seed the vault in one go. */
  reset(seed: Record<string, string> = {}): void {
    this.files.clear()
    this.dirs.clear()
    this.open = true
    for (const [path, text] of Object.entries(seed)) {
      this.files.set(path, { data: new Blob([text]), lastModified: Date.now() })
      this.ensureDirs(path)
    }
  }

  private ensureDirs(path: string): void {
    let dir = dirname(path)
    while (dir) {
      this.dirs.add(dir)
      dir = dirname(dir)
    }
  }

  async list(dir: string): Promise<Entry[]> {
    const prefix = dir ? `${dir}/` : ''
    const seen = new Map<string, Entry>()

    const consider = (path: string, kind: 'file' | 'directory') => {
      if (!path.startsWith(prefix) || path === dir) return
      const rest = path.slice(prefix.length)
      const slash = rest.indexOf('/')
      const name = slash === -1 ? rest : rest.slice(0, slash)
      if (!name) return
      seen.set(name, {
        name,
        path: prefix + name,
        kind: slash === -1 ? kind : 'directory',
      })
    }

    for (const path of this.dirs) consider(path, 'directory')
    for (const path of this.files.keys()) consider(path, 'file')
    return [...seen.values()]
  }

  async read(path: string): Promise<string> {
    return (await this.readBinary(path)).text()
  }

  async readBinary(path: string): Promise<Blob> {
    const entry = this.files.get(path)
    if (!entry) throw new Error(`No such file: ${path}`)
    return entry.data
  }

  async write(path: string, text: string): Promise<void> {
    await this.writeBinary(path, new Blob([text]))
  }

  async writeBinary(path: string, data: Blob): Promise<void> {
    this.files.set(path, { data, lastModified: Date.now() })
    this.ensureDirs(path)
  }

  async move(from: string, to: string): Promise<void> {
    const entry = this.files.get(from)
    if (!entry) throw new Error(`No such file: ${from}`)
    this.files.delete(from)
    this.files.set(to, { ...entry, lastModified: Date.now() })
    this.ensureDirs(to)
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
    this.dirs.delete(path)
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${path}/`)) this.files.delete(key)
    }
    for (const key of [...this.dirs]) {
      if (key.startsWith(`${path}/`)) this.dirs.delete(key)
    }
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
    this.ensureDirs(path)
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path)
  }

  async stat(path: string): Promise<Stat | null> {
    const entry = this.files.get(path)
    return entry ? { lastModified: entry.lastModified, size: entry.data.size } : null
  }
}

export const memoryAdapter = new MemoryAdapter()
export { MemoryAdapter }
