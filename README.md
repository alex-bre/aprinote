<p align="center">
  <img src="public/favicon.svg" width="120" alt="aprinote">
</p>

<p align="center">
  An HTML-native note-taking app.<br>
  Notes are ordinary <code>.html</code> files in a folder you choose — the notes you write <em>are</em> a website.
</p>

<p align="center">
  <a href="https://alex-bre.github.io/aprinote/"><strong>Open the app →</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0--only-blue" alt="Licence: AGPL-3.0-only"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/static/v1?label=version&message=0.1.0&color=blue" alt="Version"></a>
</p>

---

Notion/Obsidian feel, but the vault is an ordinary directory of real `.html` files — no
proprietary format, no database, no server.

## What it does

- **Three modes** — WYSIWYG editing, raw HTML editing, and a stylized read-only preview.
- **Device preview** — render a page at true 1440 / 1280 / 834 / 390px widths to check how it
  behaves on other screens.
- **Full text editing** — headings 1–4, bold/italic/underline, four alignments, bullet and
  numbered lists, links, and text/background colors from a fixed per-vault palette.
- **Rich blocks** — drag-and-drop images with layout constraints, iframe embeds, a
  Notion-style table editor, and two-, three- or four-column layouts that stack on a phone.
- **Durable page links** — links resolve by stable page id, so renaming or moving a page never
  breaks them.
- **Local files** — the app reads and writes a directory you choose. Your notes stay yours.
- **Search everything** — ⌘K searches page titles and page text, alongside the commands.
- **Works on a phone** — drawer sidebar, one-row header, and a docked formatting toolbar.
- **Light and dark** — follows your system by default, with a switch in the top bar. The theme
  covers the app chrome; your pages keep rendering the way a reader will see them.
- **Runs as an app** — the same editor on the desktop and on an Android phone, over the same
  folder of real files. See [Desktop and Android](#desktop-and-android).

## The vault

```
~/notes/
  index.html               optional vault homepage
  handbook/index.html      optional folder index page
  handbook/onboarding-guide.html
  _assets/office-map.png   all images, one flat directory
  _vault/site.css          vault-wide stylesheet, editable in-app
  _vault/vault.json        color palette, settings
```

Every page is a complete, browsable HTML document — open one straight off disk and it renders.
Point a web server at the vault root and you have a site, with no build step and no export.

## Development

```sh
npm install
npm run dev        # vite, http://localhost:5173
npm run test       # vitest — normaliser, selection, history, links, CSS scoping, vault I/O
npm run typecheck
npm run build      # tsc -b && vite build, static output into dist/
npm run preview    # serve that build locally
```

Node 22 or newer.

**Demo vault (dev only).** The vault gate offers *Start the demo vault*, or open
`http://localhost:5173/?demo` to go straight in; `?demo=0` leaves it again. It seeds the pre-filled pages in [`src/dev/vault/`](./src/dev/vault/) — every block, both folder shapes, the
stable links between them and a deliberately orphaned asset — into an in-memory vault. Nothing
is written to disk and a reload re-seeds it, so the state is always the same. The whole thing
sits behind `import.meta.env.DEV` and is absent from a production build.

Vite + React + TypeScript, CSS Modules over the design tokens in `src/styles/tokens.css`.
Everything that touches disk goes through the `VaultAdapter` port in `src/vault/` — which is
what made the native builds one adapter file rather than a rewrite.

**Browser support:** the vault uses the File System Access API, which is Chromium-only. Firefox
and Safari fall back to an in-browser (OPFS) vault you can import a folder into; zip export to
get those notes back out is still to come.

## Desktop and Android

The native builds are [Tauri v2](https://v2.tauri.app): the same frontend in an app window,
with the vault read and written by Rust instead of by a browser API. One Rust crate in
[`src-tauri/`](./src-tauri/), one adapter in
[`src/vault/adapters/tauri.ts`](./src/vault/adapters/tauri.ts), and nothing above it knows the
difference.

### Getting an APK

*Actions → Android APK → Run workflow* builds one and attaches it to the run as an artifact —
`aprinote-apk`. Download it, unzip it, and open the `.apk` on the phone; Android will ask once
for permission to install from this source.

It is signed with Gradle's debug key, because this repository holds no signing key. Android
only refuses an APK signed with *nothing*, so that is enough to install and use — it is not
enough for the Play Store. To use a real key, write
`src-tauri/gen/android/keystore.properties` (gitignored) and the release build picks it up:

```properties
storeFile=../../../my-release-key.jks
storePassword=…
keyAlias=aprinote
keyPassword=…
```

The workflow builds for `arm64` by default — every phone made in the last decade. Pick
`universal` in the dispatch form for an APK that also runs on x86 emulators, at roughly double
the size.

### Where the notes live on a phone

Android has no folder picker an app like this can use: the only one returns a handle that
cannot be listed or written into as a directory, so the vault has to be a path. aprinote offers
two.

**Its own folder**, which is what *Open my vault* uses:

```
/storage/emulated/0/Android/data/com.aprinote.app/files/Documents/aprinote
```

No permission, reachable over USB — and deleted if you uninstall the app, so it is the
convenient one rather than the safe one.

**A folder of your own**, typed into *Use another folder* — `/storage/emulated/0/notes`, say,
which other apps and Syncthing can also see. Android keeps raw access to shared storage behind
*All files access*, so grant it once. The gate checks before it opens anything, and while the
permission is missing it offers **Allow all files access**, which opens the switch for aprinote
in Settings; come back to the app and the gate picks up the change. By hand it is:

> Settings → Apps → Special app access → **All files access** → aprinote.

### Building it yourself

```sh
bash scripts/setup-android.sh        # Rust + the four Android targets, SDK, NDK (~3 GB, once)
npm run android:apk                  # signed release APK, under src-tauri/gen/android/app/build/outputs/
npm run android:apk -- --target aarch64   # arm64 only: one ABI to compile instead of four
npm run android:dev                  # live reload onto a device plugged in over adb
```

`npm run android:apk -- --debug` builds the debug variant instead. It installs just as well,
but its `.so` is unoptimised and carries full debug info — 130 MB of APK against roughly ten —
so it is for when something needs debugging, not for carrying around.

`scripts/android-env.sh` exports the toolchain paths, and every `android:*` script sources it,
so nothing needs to be in your shell profile. Override `ANDROID_HOME`, `NDK_HOME` or
`ANDROID_JAVA_HOME` and yours wins.

The desktop build is the same project:

```sh
npm run desktop                 # tauri dev — vite with a native window in front of it
npm run desktop:build           # a bundle for the platform you are on
```

Linux also needs the webview headers (`libwebkit2gtk-4.1-dev`, `librsvg2-dev`); macOS and
Windows need nothing beyond Rust. The desktop build gets a real folder picker — Android is the
platform with the constraint, not Tauri.

## Releases and deployment

Four workflows under the repository's **Actions** tab, all startable by hand.

**The site** — `.github/workflows/pages.yml` typechecks (via the build), tests, builds, and
publishes `dist/` to GitHub Pages on whichever branch is picked, normally `main`. Pushes to
`main` do not change the live site: a deploy is always a deliberate act.

**The tests** — `.github/workflows/test.yml` runs `npm run typecheck` and the vitest suite on
demand, and checks that `THIRD-PARTY-NOTICES` is current. Pages and Release run the tests too,
before they publish anything.

**The Android APK** — `.github/workflows/android.yml` builds a release APK (signed with Gradle's debug key) and attaches it to
the run, as described in [Desktop and Android](#desktop-and-android). It is not part of a
release: the release attaches the static web build, and the APK is built when you want one.

**A release** can be cut either on GitHub or locally. Both write the CHANGELOG entry, bump the
version in `package.json`, `package-lock.json` and the README badge, commit, and tag `vX.Y.Z`.

*On GitHub:* *Actions → Release → Run workflow*, then choose the bump (`minor`, `patch`,
`major`, or `custom` with a version such as `0.2.0` in the version field). Tick *dry run* first
to see the changelog entry in the run summary without changing anything. A real run tests, cuts
the release on `main`, pushes the commit and tag, and publishes the GitHub Release — one run
does it all. `custom` with an existing tag (e.g. `v0.1.0`) skips the cutting and only publishes
that tag, for a tag that has no release yet.

*Locally:*

```sh
npm run release -- --minor             # or --patch / --major / an explicit 0.2.0
npm run release -- --minor --dry-run   # see the changelog entry first
git push --follow-tags                 # after reviewing the commit
```

Pushing the tag starts the same workflow, which publishes it.

Either way the GitHub Release gets that version's [CHANGELOG](./CHANGELOG.md) entry as its notes
and the static build attached as a zip. The site is not redeployed by a release; run Pages
afterwards if it should show the new version.

Only conventional-commit subjects (`feat:`, `fix:`, `perf:`, `revert:`, `refactor:`, `docs:`)
reach the changelog; `chore:`, `ci:` and `test:` are deliberately left out.

## Hosting the build

`dist/` is a folder of static files — put it behind any web server. `base` is `'./'`, so it
works from a domain root or a sub-path alike, and the only URL state is the `?demo` flag, so
there is no SPA fallback rewrite to configure. `dist/assets/*` carry a content hash and can be
cached forever; `index.html` should not be.

Note that the app itself needs no server: it reads and writes a local directory from the
browser. Hosting only distributes the app, never anyone's notes.

## Repository layout

| Path | What it is |
|---|---|
| `CHANGELOG.md` | Written by the release script; the release notes come from it. |
| `LICENSE`, `THIRD-PARTY-NOTICES` | The app's licence, and the bundled packages' — both ship inside the build. |
| `.github/workflows/` | Pages, Tests, Release and Android APK — see above. |
| `scripts/release.mjs` | Cuts a release: changelog entry, version bump, commit, tag. |
| `scripts/gen-third-party-notices.mjs` | Regenerates `THIRD-PARTY-NOTICES` (`npm run notices`). |
| `scripts/setup-android.sh` | Installs the Android toolchain; `android-env.sh` exports its paths. |
| `src-tauri/` | The native app: the `vault_*` commands, the config, the Android project. |
| `src/ui/` | The app shell — sidebar, top bar, panes, inspector, status bar. |
| `src/vault/` | The filesystem port, its adapters, and the page document format. |
| `src/editor/` | The editor port, its DOM layer, and the formatting commands. |
| `src/store/` | Vault state and autosave; per-session UI state; theme. |
| `src/platform/` | Whether this is a tab or an app window, and links out to the browser. |
| `src/styles/doc.css` | The default vault stylesheet, written to new vaults as `site.css`. |
| `src/dev/` | The dev-only demo vault: `vault/` is the fixture files, `demoVault.ts` seeds them. |

## Licence

**GNU Affero General Public License v3.0 only** — see [LICENSE](LICENSE).

The clause worth knowing about is §13: if you modify aprinote and let other people use your
version *over a network*, you have to offer those users its source. Self-hosting an unmodified
copy carries no such obligation. The practical way to comply with a public fork is a visible
source link inside the app — which *Settings → About* already has, taken from `repository` in
`package.json`.

The licence covers the code. It grants no rights to the aprinote name or logo.

### Bundled libraries

Listed with their copyright notices in [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES), which ships
with the build — *Settings → About* shows it — because the MIT and ISC terms require it and
minified output carries none. Regenerate after any dependency change with `npm run notices`.
It covers the JavaScript bundle; the Rust and Android dependencies compiled into the native
builds are not listed yet.
