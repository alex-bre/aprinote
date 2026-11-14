/**
 * Renders the app icon the Tauri bundles need from the same apricot the app
 * draws in `src/ui/BrandMark.tsx`.
 *
 *   node scripts/make-icon.mjs      # -> src-tauri/icons/source.png (1024²)
 *   npx tauri icon src-tauri/icons/source.png
 *
 * The mark sits on a filled square at 62% of the canvas: a launcher icon has no
 * transparency to hide in, and Android's adaptive icon crops to a circle, so
 * everything has to live well inside the safe zone.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../src-tauri/icons/source.png')
const SIZE = 1024

const page = `<!doctype html>
<style>
  html, body { margin: 0; width: ${SIZE}px; height: ${SIZE}px; }
  body { display: grid; place-items: center; background: #fdf6ee; }
  svg { width: 62%; height: 62%; display: block; }
</style>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="19.4" r="9.8" fill="#e8934e"/>
  <path d="M16 9.6a9.8 9.8 0 0 1 0 19.6C20.5 24.5 20.5 14.3 16 9.6Z" fill="#cf7433"/>
  <path d="M16 9.9c-2.5 2.7-2.5 16.3 0 19" stroke="#cf7433" stroke-width="1.1" stroke-linecap="round"/>
  <path d="M16.4 5.6c1.1-1.3 3-2 5.3-2-.2 2.5-1.6 4.2-3.6 4.8" fill="#6f9455"/>
  <path d="M16 10V6.6" stroke="#7a5230" stroke-width="1.3" stroke-linecap="round"/>
</svg>`

await mkdir(dirname(out), { recursive: true })
const browser = await chromium.launch()
const tab = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })
await tab.setContent(page)
await tab.screenshot({ path: out })
await browser.close()
console.log(`wrote ${out}`)
