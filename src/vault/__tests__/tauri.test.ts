import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NativeEnv } from '../adapters/tauri'

/**
 * The native adapter is a translation layer — it turns `VaultAdapter` calls into
 * `vault_*` commands — so these tests stand a fake Rust side up and check the
 * translation. What they are really pinning down is the two places the native
 * backend is not like the browser ones: Android has no folder picker, and access
 * can be refused rather than merely missing.
 */

const invoke = vi.fn()
let native = true

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@/platform/native', () => ({
  isNative: () => native,
  openExternal: async () => true,
}))

const DESKTOP: NativeEnv = {
  os: 'linux',
  mobile: false,
  canPickFolder: true,
  defaultRoot: '/home/a/aprinote',
  canUseAnyPath: true,
}

const ANDROID: NativeEnv = {
  os: 'android',
  mobile: true,
  canPickFolder: false,
  defaultRoot: '/storage/emulated/0/Android/data/com.aprinote.app/files/Documents/aprinote',
  canUseAnyPath: false,
}

/** A fresh adapter per test: the real one caches the environment for the process. */
async function adapterWith(env: NativeEnv) {
  vi.resetModules()
  invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === 'vault_env') return Promise.resolve(env)
    if (command === 'vault_open') {
      const path = String(args?.path)
      return Promise.resolve({ root: path, name: path.split('/').pop() })
    }
    return Promise.resolve(null)
  })
  const { tauriAdapter } = await import('../adapters/tauri')
  return tauriAdapter
}

beforeEach(() => {
  native = true
  localStorage.clear()
})

afterEach(() => {
  invoke.mockReset()
})

describe('availability', () => {
  it('is the adapter for the native build only', async () => {
    const adapter = await adapterWith(DESKTOP)
    expect(adapter.available()).toBe(true)
    native = false
    expect(adapter.available()).toBe(false)
  })
})

describe('opening a vault', () => {
  it('asks the system picker on desktop', async () => {
    const adapter = await adapterWith(DESKTOP)
    invoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
      if (command === 'vault_env') return Promise.resolve(DESKTOP)
      if (command === 'vault_pick') return Promise.resolve('/home/a/notes')
      if (command === 'vault_open') return Promise.resolve({ root: args?.path, name: 'notes' })
      return Promise.resolve(null)
    })

    expect(await adapter.pick()).toEqual({ adapterId: 'tauri', name: 'notes', connected: true })
    expect(invoke).toHaveBeenCalledWith('vault_pick')
    expect(invoke).toHaveBeenCalledWith('vault_open', { path: '/home/a/notes' })
  })

  it('reports a dismissed picker as nothing opened', async () => {
    const adapter = await adapterWith(DESKTOP)
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'vault_env' ? DESKTOP : null),
    )
    expect(await adapter.pick()).toBeNull()
  })

  it('goes straight to the default folder on Android, which has no picker', async () => {
    const adapter = await adapterWith(ANDROID)
    const ref = await adapter.pick()

    expect(ref?.name).toBe('aprinote')
    expect(invoke).not.toHaveBeenCalledWith('vault_pick', expect.anything())
    expect(invoke).toHaveBeenCalledWith('vault_open', { path: ANDROID.defaultRoot })
  })

  it('opens a folder named by path, and remembers it for next launch', async () => {
    const adapter = await adapterWith(ANDROID)
    expect(await adapter.openAt('/sdcard/notes')).toEqual({
      adapterId: 'tauri',
      name: 'notes',
      connected: true,
    })

    const reopened = await (await adapterWith(ANDROID)).restore()
    expect(reopened).toEqual({ adapterId: 'tauri', name: 'notes', connected: true })
  })

  it('has nothing to restore before a vault is ever opened', async () => {
    expect(await (await adapterWith(ANDROID)).restore()).toBeNull()
  })

  it('restores as disconnected when the folder can no longer be reached', async () => {
    const adapter = await adapterWith(ANDROID)
    await adapter.openAt('/sdcard/notes')

    const next = await adapterWith(ANDROID)
    invoke.mockImplementation((command: string) => {
      if (command === 'vault_env') return Promise.resolve(ANDROID)
      // What a revoked "All files access" looks like from here.
      if (command === 'vault_open') return Promise.reject(new Error('Permission denied'))
      return Promise.resolve(null)
    })

    // Disconnected, not an error: the gate offers to reconnect, and the vault
    // keeps its name.
    expect(await next.restore()).toEqual({
      adapterId: 'tauri',
      name: 'notes',
      connected: false,
    })
  })

  it('forgets the remembered folder on close', async () => {
    const adapter = await adapterWith(ANDROID)
    await adapter.openAt('/sdcard/notes')
    await adapter.forget()

    expect(invoke).toHaveBeenCalledWith('vault_close')
    expect(await (await adapterWith(ANDROID)).restore()).toBeNull()
  })
})

describe('binary files', () => {
  it('types a read blob from its extension, as the handle adapters do', async () => {
    const adapter = await adapterWith(ANDROID)
    const bytes = new Uint8Array([137, 80, 78, 71])
    invoke.mockImplementation((command: string) => {
      if (command === 'vault_env') return Promise.resolve(ANDROID)
      if (command === 'vault_read_binary') return Promise.resolve(bytes.buffer)
      return Promise.resolve(null)
    })

    const blob = await adapter.readBinary('_assets/photo.png')
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })

  it('sends a written blob as base64', async () => {
    const adapter = await adapterWith(ANDROID)
    await adapter.writeBinary('_assets/a.png', new Blob([new Uint8Array([0, 1, 2, 253])]))

    expect(invoke).toHaveBeenCalledWith('vault_write_binary', {
      path: '_assets/a.png',
      data: 'AAEC/Q==',
    })
  })

  it('survives a blob far past the argument-list limit', async () => {
    const adapter = await adapterWith(ANDROID)
    // 0x8000 is the chunk size, and `fromCharCode(...bytes)` on a megabyte of
    // them is a stack overflow — which is the size of a photo off a phone.
    const big = new Uint8Array(1_200_000).fill(65)
    await adapter.writeBinary('_assets/big.jpg', new Blob([big]))

    const [, args] = invoke.mock.calls.find(([command]) => command === 'vault_write_binary')!
    expect(atob((args as { data: string }).data)).toHaveLength(big.length)
  })
})

describe('file operations', () => {
  it('passes vault-relative paths straight through to the commands', async () => {
    const adapter = await adapterWith(ANDROID)
    await adapter.openAt('/sdcard/notes')

    await adapter.write('handbook/a.html', '<p>hi</p>')
    await adapter.move('a.html', 'b/a.html')
    await adapter.mkdir('b')
    await adapter.remove('a.html')
    await adapter.list('handbook')
    await adapter.stat('a.html')

    expect(invoke).toHaveBeenCalledWith('vault_write', {
      path: 'handbook/a.html',
      text: '<p>hi</p>',
    })
    expect(invoke).toHaveBeenCalledWith('vault_move', { from: 'a.html', to: 'b/a.html' })
    expect(invoke).toHaveBeenCalledWith('vault_mkdir', { path: 'b' })
    expect(invoke).toHaveBeenCalledWith('vault_remove', { path: 'a.html' })
    expect(invoke).toHaveBeenCalledWith('vault_list', { dir: 'handbook' })
    expect(invoke).toHaveBeenCalledWith('vault_stat', { path: 'a.html' })
  })
})
