import { useEffect, useRef } from 'react'
import { Database, FlaskConical, FolderOpen, RotateCcw, Upload } from 'lucide-react'
import { fsaAdapter } from '@/vault/adapters/fsa'
import { opfsAdapter } from '@/vault/adapters/opfs'
import { tauriAdapter } from '@/vault/adapters/tauri'
import { useVault } from '@/store/vaultStore'
import { BrandMark } from './BrandMark'
import { NativeVaultGate } from './NativeVaultGate'
import styles from './VaultGate.module.css'

/** Shown until a vault is open: pick a folder, re-grant a lapsed permission, or import. */
export function VaultGate() {
  const status = useVault((s) => s.status)
  const ref = useVault((s) => s.ref)
  const error = useVault((s) => s.error)
  const open = useVault((s) => s.open)
  const reconnect = useVault((s) => s.reconnect)
  const restore = useVault((s) => s.restore)
  const openDemo = useVault((s) => s.openDemo)

  useEffect(() => {
    void restore()
  }, [restore])

  // The native app has one backend and its own way in: no grant to lapse, no
  // in-browser vault to fall back to, and on Android no folder picker at all.
  const native = tauriAdapter.available()
  const reconnecting = status === 'disconnected'
  const opening = status === 'opening'

  return (
    <div className={styles.gate}>
      <div className={styles.card}>
        <div className={styles.mark}>
          <BrandMark size={24} />
        </div>

        {reconnecting ? (
          <>
            <h1 className={styles.title}>Reconnect “{ref?.name}”</h1>
            <p className={styles.blurb}>
              {native
                ? 'aprinote cannot reach this vault’s folder. If it is on removable storage, or it needs a permission that has been turned off, put that right and try again.'
                : 'aprinote still remembers this vault, but the browser drops folder permission between sessions. One click restores it — no re-picking.'}
            </p>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={() => void reconnect()}>
                <RotateCcw size={16} />
                Reconnect vault
              </button>
              <button className={styles.secondary} onClick={() => void open()}>
                <FolderOpen size={15} />
                Choose a different folder
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Open a vault</h1>
            <p className={styles.blurb}>
              A vault is an ordinary folder of <code>.html</code> files. aprinote reads and writes
              it in place — nothing is copied, and nothing leaves your machine.
            </p>

            {error && <div className={styles.error}>{error}</div>}

            {native ? <NativeVaultGate opening={opening} /> : <BrowserVaultGate opening={opening} />}
          </>
        )}

        {/* Development only — folded away entirely by a production build. */}
        {import.meta.env.DEV && (
          <div className={styles.dev}>
            <button className={styles.ghost} onClick={() => void openDemo()} disabled={opening}>
              <FlaskConical size={14} />
              Start the demo vault
            </button>
            <p className={styles.devNote}>
              Eight pre-filled pages showing every block, both folder shapes and the stable
              links between them. Held in memory: a reload re-seeds it, so nothing you do in
              there is kept.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * The two browser answers: a real folder where the File System Access API exists,
 * and the in-browser vault — with a folder import into it — everywhere else.
 */
function BrowserVaultGate({ opening }: { opening: boolean }) {
  const open = useVault((s) => s.open)
  const importFolder = useVault((s) => s.importFolder)
  const picker = useRef<HTMLInputElement>(null)
  const hasFsa = fsaAdapter.available()

  return (
    <>
      <div className={styles.actions}>
        {hasFsa ? (
          <button
            className={styles.primary}
            onClick={() => void open(fsaAdapter)}
            disabled={opening}
          >
            <FolderOpen size={16} />
            {opening ? 'Opening…' : 'Open vault folder'}
          </button>
        ) : (
          <button
            className={styles.primary}
            onClick={() => picker.current?.click()}
            disabled={opening}
          >
            <Upload size={16} />
            Import a folder
          </button>
        )}
        {/* Always offered, in every browser: it is the only vault some
            browsers can open, and the one a folder import lands in. */}
        <button
          className={styles.secondary}
          onClick={() => void open(opfsAdapter)}
          disabled={opening}
        >
          <Database size={15} />
          Start an empty in-browser vault
        </button>
      </div>

      <p className={styles.note}>
        {hasFsa ? (
          'aprinote keeps the vault in a folder you can see. Your notes are the website.'
        ) : (
          <>
            This browser has no File System Access API, so aprinote keeps the vault inside the
            browser instead of in a folder you can see. Importing copies your files in.
          </>
        )}
      </p>

      <input
        ref={picker}
        className={styles.hidden}
        type="file"
        multiple
        webkitdirectory=""
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          if (files.length) void importFolder(files)
        }}
      />
    </>
  )
}
