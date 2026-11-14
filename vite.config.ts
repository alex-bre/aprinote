import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'

// `base: './'` keeps asset paths relative, so the build serves from a domain root
// or a sub-path alike — Pages publishes it under /aprinote/. Nothing routes on
// the path (the only URL state is the `?demo` flag), so no rewrite is needed.

// Set by `tauri android dev` to the address the phone can reach this machine
// on. Unset for a desktop or browser run, where localhost is the whole story.
const host = process.env.TAURI_DEV_HOST

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')

const pkg = JSON.parse(read('package.json')) as { version: string; repository: { url: string } }

/**
 * Which commit a build came from, for the About section — package.json's
 * version rarely moves, so on its own it names no code.
 *
 * Falls back rather than failing: CI exports GITHUB_SHA, and a build from a
 * source zip has no `.git` at all.
 */
function commitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  const git = (args: string[]) =>
    execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  try {
    // Tracked files only: Vite writes a `vite.config.ts.timestamp-*.mjs` beside
    // this file while loading it, which would mark every build dirty.
    const dirty = git(['status', '--porcelain', '--untracked-files=no'])
    return git(['rev-parse', '--short', 'HEAD']) + (dirty ? '-dirty' : '')
  } catch {
    return 'unknown'
  }
}

/**
 * Licence texts that have to ship inside the build, as `[source, servedAs]`.
 *
 * The MIT and ISC terms of our dependencies require their notices to accompany
 * the *distributed build* — the site, the release zip and the app bundles alike —
 * and minified bundles carry none. The root copies stay the single source of
 * truth; the build takes a copy. `.txt` because a static host has no MIME type
 * for an extensionless file and would offer it as a download.
 */
const SHIPPED_LICENCE_FILES = [
  ['LICENSE', 'LICENSE.txt'],
  ['THIRD-PARTY-NOTICES', 'THIRD-PARTY-NOTICES.txt'],
] as const

function shipLicenceFiles(): Plugin {
  return {
    name: 'ship-licence-files',
    // Emitted rather than copied by hand so they follow `outDir`.
    generateBundle() {
      for (const [source, fileName] of SHIPPED_LICENCE_FILES) {
        this.emitFile({ type: 'asset', fileName, source: read(source) })
      }
    },
    // The About section loads these, so they have to resolve in `vite dev` too.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]
        const entry = SHIPPED_LICENCE_FILES.find(([, fileName]) => path === `/${fileName}`)
        if (!entry) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(read(entry[0]))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), shipLicenceFiles()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__: JSON.stringify(commitSha()),
    // AGPL §13 obliges a network-served copy to offer its users the source.
    // Taken from package.json, so a fork only has to change it there.
    __SOURCE_URL__: JSON.stringify(pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '')),
  },
  // The Tauri CLI starts this server and then points a webview at it, so the
  // port cannot drift and the Rust crate must not trip the watcher: a touched
  // file under src-tauri/ means a rebuild, which would reload the frontend in
  // a loop.
  server: {
    port: 5173,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // The CLI's own output is what matters during a native run.
  clearScreen: false,
  test: {
    // jsdom, not happy-dom: DOMPurify misbehaves badly under happy-dom (its default
    // config there strips <p> and keeps <script>), and the editor tests are exactly
    // the ones that need a faithful DOM. jsdom also fetches no subresources.
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
