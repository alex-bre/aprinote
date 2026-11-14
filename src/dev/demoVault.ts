/**
 * The demo vault — development only.
 *
 * `src/dev/vault/` is an ordinary vault checked into the repo: real `.html`
 * documents, real assets, real `data-aprinote` links between them. This module seeds
 * those files into an in-memory adapter so `npm run dev` can start on a vault that
 * already has something in it, without asking for a folder and without touching
 * one.
 *
 * In memory on purpose. The files are fixtures: a reload re-seeds them, so every
 * session starts from the same known state and a destructive experiment costs
 * nothing. Anything worth keeping belongs in a real vault from the gate.
 *
 * Everything here is behind `import.meta.env.DEV` at every call site, and this
 * module is only ever reached through a dynamic `import()` inside such a branch —
 * which is what keeps the demo content out of a production bundle.
 */

import type { VaultRef } from '@/vault/VaultAdapter'
import { MemoryAdapter } from '@/vault/adapters/memory'
import { assetMime } from '@/vault/assets'

export const DEMO_VAULT_NAME = 'Demo vault'
/** The page the demo opens on — the vault homepage, not whatever scans first. */
export const DEMO_HOME = 'index.html'

/** Survives a reload, so dev work carries on in the demo rather than at the gate. */
const FLAG = 'aprinote.demo'

const PREFIX = './vault/'

const pageFiles = import.meta.glob('./vault/**/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

// Text-shaped assets only: `?raw` cannot carry bytes, and an SVG says everything a
// PNG would about depth-relative `src`, the inspector's constraints and the
// orphan sweep.
const assetFiles = import.meta.glob('./vault/_assets/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Glob keys are module paths; the vault knows them without the `./vault/` root. */
function vaultPaths(files: Record<string, string>): [string, string][] {
  return Object.entries(files).map(([key, text]) => [key.slice(PREFIX.length), text])
}

class DemoAdapter extends MemoryAdapter {
  readonly label = DEMO_VAULT_NAME

  private mounted = false

  private ref(): VaultRef {
    return { adapterId: this.id, name: DEMO_VAULT_NAME, connected: true }
  }

  /** Wipe whatever the last session did and lay the fixtures down again. */
  private async seed(): Promise<void> {
    this.reset(Object.fromEntries(vaultPaths(pageFiles)))
    for (const [path, text] of vaultPaths(assetFiles)) {
      // Typed, unlike `write`'s blob: an untyped image is an image that renders
      // as nothing once it leaves the app's origin, in preview or in an <img>.
      await this.writeBinary(path, new Blob([text], { type: assetMime(path) }))
    }
    this.mounted = true
  }

  async pick(): Promise<VaultRef | null> {
    await this.seed()
    return this.ref()
  }

  /** Only within a page load — a reload re-seeds through `pick` instead. */
  async restore(): Promise<VaultRef | null> {
    return this.mounted ? this.ref() : null
  }

  async reconnect(): Promise<VaultRef | null> {
    return this.pick()
  }

  async forget(): Promise<void> {
    this.mounted = false
    this.reset()
    remember(false)
  }
}

export const demoAdapter = new DemoAdapter()

/**
 * Whether this load should land in the demo vault.
 *
 * `?demo` turns it on and `?demo=0` turns it back off — that second form is the
 * way out, because nothing in the app chrome closes an open vault and the demo
 * would otherwise reclaim every reload. Failing either, last session's flag decides.
 */
export function demoRequested(): boolean {
  try {
    const asked = new URLSearchParams(location.search).get('demo')
    if (asked === null) return localStorage.getItem(FLAG) === '1'

    const on = asked !== '0' && asked !== 'false'
    remember(on)
    return on
  } catch {
    return false
  }
}

export function remember(on: boolean): void {
  try {
    if (on) localStorage.setItem(FLAG, '1')
    else localStorage.removeItem(FLAG)
  } catch {
    // Then the demo just won't survive a reload; it still opens.
  }
}
