import { useEffect, useState } from 'react'
import { Eraser, ExternalLink, FileText, RotateCcw, Trash2, X } from 'lucide-react'
import { isNative, openExternal } from '@/platform/native'
import { useVault } from '@/store/vaultStore'
import { DEFAULT_SETTINGS, TEXT_PALETTE, BACKGROUND_PALETTE } from '@/vault/palette'
import styles from './Settings.module.css'

/**
 * Settings: the per-vault colour palette, the unused-asset sweep, and
 * what this build is and where its source lives.
 *
 * The first two write to the vault, not to the browser — the palette lives in
 * `_vault/vault.json` so it travels with the notes.
 */
export function Settings({ onClose }: { onClose: () => void }) {
  const settings = useVault((s) => s.settings)
  const saveSettings = useVault((s) => s.saveSettings)
  const findUnusedAssets = useVault((s) => s.findUnusedAssets)
  const deleteAssets = useVault((s) => s.deleteAssets)

  const [draft, setDraft] = useState(settings)
  const [orphans, setOrphans] = useState<string[] | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => setDraft(settings), [settings])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setColor = (kind: 'text' | 'background', index: number, hex: string) => {
    const next = {
      ...draft,
      palette: { ...draft.palette, [kind]: draft.palette[kind].map((c, i) => (i === index ? hex : c)) },
    }
    setDraft(next)
    void saveSettings(next)
  }

  const sweep = async () => {
    setScanning(true)
    setOrphans(await findUnusedAssets())
    setScanning(false)
  }

  const row = (kind: 'text' | 'background', label: string, names: typeof TEXT_PALETTE) => (
    <div className={styles.section}>
      <div className={styles.label}>{label}</div>
      <div className={styles.swatches}>
        {draft.palette[kind].map((hex, index) => (
          <label key={index} className={styles.swatch} title={names[index]?.name ?? hex}>
            <span style={{ background: hex }} />
            <input
              type="color"
              value={hex}
              onChange={(event) => setColor(kind, index, event.target.value)}
            />
            <code>{hex}</code>
          </label>
        ))}
      </div>
    </div>
  )

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
        <div className={styles.head}>
          <span>Settings</span>
          <button className={styles.close} onClick={onClose} title="Close">
            <X size={15} />
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.blurb}>
            These live in <code>_vault/vault.json</code>, so they travel with the notes rather than
            with this browser.
          </p>

          {row('text', 'Text colours', TEXT_PALETTE)}
          {row('background', 'Background colours', BACKGROUND_PALETTE)}

          <button
            className={styles.reset}
            onClick={() => {
              setDraft(DEFAULT_SETTINGS)
              void saveSettings(DEFAULT_SETTINGS)
            }}
          >
            <RotateCcw size={13} /> Reset the palette
          </button>

          <div className={styles.section}>
            <div className={styles.label}>Unused assets</div>
            <p className={styles.blurb}>
              Files in <code>_assets/</code> that no page references. Offered, never removed
              automatically — an image you hand-linked in raw HTML looks identical to garbage.
            </p>

            <button className={styles.reset} onClick={() => void sweep()} disabled={scanning}>
              <Eraser size={13} /> {scanning ? 'Scanning…' : 'Find unused assets'}
            </button>

            {orphans !== null && orphans.length === 0 && (
              <div className={styles.clean}>Nothing unused — every asset is referenced.</div>
            )}

            {orphans !== null && orphans.length > 0 && (
              <>
                <div className={styles.orphans}>
                  {orphans.map((name) => (
                    <code key={name}>{name}</code>
                  ))}
                </div>
                <button
                  className={`${styles.reset} ${styles.danger}`}
                  onClick={() => {
                    if (!window.confirm(`Permanently delete ${orphans.length} unused file(s)?`)) return
                    void deleteAssets(orphans).then(() => setOrphans([]))
                  }}
                >
                  <Trash2 size={13} /> Delete {orphans.length} file{orphans.length === 1 ? '' : 's'}
                </button>
              </>
            )}
          </div>

          <About />
        </div>
      </div>
    </div>
  )
}

/** The two texts the build ships beside itself (see `vite.config.ts`). */
const LICENCE_TEXTS = {
  licence: { label: 'Licence', file: './LICENSE.txt' },
  notices: { label: 'Third-party notices', file: './THIRD-PARTY-NOTICES.txt' },
} as const

type LicenceText = keyof typeof LICENCE_TEXTS

/**
 * Version, commit and a way to the source. The source link is what AGPL §13
 * asks of anyone who serves a modified copy — it comes from package.json, so a
 * fork that changes `repository` points at itself.
 *
 * The licence texts are shown in place rather than linked: in the app builds a
 * relative link has nowhere to open, but a fetch of a bundled file works.
 */
function About() {
  const [open, setOpen] = useState<LicenceText | null>(null)
  const [text, setText] = useState('')

  const show = (which: LicenceText) => {
    if (open === which) return setOpen(null)
    setOpen(which)
    setText('Loading…')
    fetch(LICENCE_TEXTS[which].file)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error())))
      .then(setText, () => setText('This build does not include the file.'))
  }

  return (
    <div className={styles.section}>
      <div className={styles.label}>About</div>
      <p className={styles.blurb}>
        aprinote {__APP_VERSION__} · <code>{__COMMIT_SHA__}</code>
        <br />
        Free software under the GNU Affero General Public License v3.0.
      </p>
      <div className={styles.links}>
        <a
          className={styles.reset}
          href={__SOURCE_URL__}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (!isNative()) return
            event.preventDefault()
            void openExternal(__SOURCE_URL__)
          }}
        >
          <ExternalLink size={13} /> Source code
        </a>
        {(Object.keys(LICENCE_TEXTS) as LicenceText[]).map((which) => (
          <button
            key={which}
            className={styles.reset}
            aria-pressed={open === which}
            onClick={() => show(which)}
          >
            <FileText size={13} /> {LICENCE_TEXTS[which].label}
          </button>
        ))}
      </div>
      {open && <pre className={styles.licence}>{text}</pre>}
    </div>
  )
}
