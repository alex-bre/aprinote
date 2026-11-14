/**
 * Which runtime the app is in, and the one thing a native webview cannot do for
 * itself: hand a link to the real browser.
 *
 * Nothing filesystem-shaped lives here — that is the adapter's job. This is
 * only the question "am I a browser tab or an app window", which the shell and
 * the link handler both have to ask.
 */

import { isTauri } from '@tauri-apps/api/core'

/** True in the Tauri desktop and Android builds, false in a browser tab. */
export function isNative(): boolean {
  try {
    return isTauri()
  } catch {
    return false
  }
}

/**
 * Open a link outside the app.
 *
 * `window.open` is the browser answer and the wrong one here: in a native
 * webview the app *is* the window, so a new one either never appears (Android)
 * or opens a second chrome-less app window (desktop). The opener plugin hands
 * the URL to the system instead, which is what a user clicking an https link in
 * their notes means. Loaded on demand so a browser build never pulls it in.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isNative()) return false
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return true
  } catch {
    return false
  }
}
