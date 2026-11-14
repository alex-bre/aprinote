import type { Entry, Stat } from '../VaultAdapter'
import { assetMime } from '../assets'
import { basename, dirname } from '../paths'

/**
 * The file layer shared by the two handle-backed adapters. FSA and OPFS differ
 * only in where the root handle comes from and what permission it needs — every
 * read and write below is identical.
 */
export abstract class HandleFileSystem {
  protected root: FileSystemDirectoryHandle | null = null

  protected get dir(): FileSystemDirectoryHandle {
    if (!this.root) throw new Error('No vault is open')
    return this.root
  }

  protected async directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let handle = this.dir
    for (const segment of path.split('/').filter(Boolean)) {
      handle = await handle.getDirectoryHandle(segment, { create })
    }
    return handle
  }

  private async file(path: string, create = false): Promise<FileSystemFileHandle> {
    const parent = await this.directory(dirname(path), create)
    return parent.getFileHandle(basename(path), { create })
  }

  async list(dir: string): Promise<Entry[]> {
    const handle = await this.directory(dir)
    const entries: Entry[] = []
    for await (const [name, child] of handle.entries()) {
      entries.push({ name, path: dir ? `${dir}/${name}` : name, kind: child.kind })
    }
    return entries
  }

  async read(path: string): Promise<string> {
    return (await (await this.file(path)).getFile()).text()
  }

  /**
   * Bytes, with a media type the rest of the app can rely on.
   *
   * A `File` off a handle carries whatever type the backend felt like — OPFS
   * hands back an empty one in some browsers — and a typeless blob is a blob URL
   * served as nothing, which Firefox then declines to render as an image. The
   * extension is the only thing that is always there, so it decides.
   */
  async readBinary(path: string): Promise<Blob> {
    const file = await (await this.file(path)).getFile()
    if (file.type) return file
    const mime = assetMime(path)
    return mime ? new Blob([file], { type: mime }) : file
  }

  async write(path: string, text: string): Promise<void> {
    const writable = await (await this.file(path, true)).createWritable()
    await writable.write(text)
    await writable.close()
  }

  async writeBinary(path: string, data: Blob): Promise<void> {
    const writable = await (await this.file(path, true)).createWritable()
    await writable.write(data)
    await writable.close()
  }

  /** No native move in either API — copy the bytes, then drop the original. */
  async move(from: string, to: string): Promise<void> {
    const blob = await this.readBinary(from)
    await this.writeBinary(to, blob)
    await this.remove(from)
  }

  async remove(path: string): Promise<void> {
    const parent = await this.directory(dirname(path))
    await parent.removeEntry(basename(path), { recursive: true })
  }

  async mkdir(path: string): Promise<void> {
    await this.directory(path, true)
  }

  async exists(path: string): Promise<boolean> {
    if ((await this.stat(path)) !== null) return true
    // `stat` only knows about files, but a directory exists just as much — the
    // asset sweep asks about `_assets/` before listing it.
    try {
      await this.directory(path)
      return true
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<Stat | null> {
    try {
      const file = await (await this.file(path)).getFile()
      return { lastModified: file.lastModified, size: file.size }
    } catch {
      return null
    }
  }
}
