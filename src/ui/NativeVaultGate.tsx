import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, ShieldCheck, TriangleAlert } from 'lucide-react'
import { useVault } from '@/store/vaultStore'
import { tauriAdapter, type NativeEnv, type PathProbe } from '@/vault/adapters/tauri'
import styles from './VaultGate.module.css'

/**
 * How a vault is opened in the native app.
 *
 * Desktop is the easy half: one button, the system folder picker. Android has no
 * directory picker to offer — Tauri's dialog plugin has none, because the only
 * Android one hands back a SAF tree URI that cannot be listed or written into as
 * a path — so the vault is reached by path instead:
 *
 * * the default is the app's own documents directory, which needs no permission
 *   and is the button that always works;
 * * any other folder is typed in, and shared storage there needs Android's "All
 *   files access". That is what `probe` asks about before opening, so a missing
 *   permission is explained here rather than surfacing as a failed write later,
 *   and a button opens the Settings screen that grants it.
 */
export function NativeVaultGate({ opening }: { opening: boolean }) {
  const open = useVault((state) => state.open)
  const openAt = useVault((state) => state.openAt)

  const [env, setEnv] = useState<NativeEnv | null>(null)
  const [elsewhere, setElsewhere] = useState(false)
  const [path, setPath] = useState('')
  const [probe, setProbe] = useState<PathProbe | null>(null)
  // "All files access", which unlike the rest of `env` can change while the
  // gate is up: the user grants it in Settings and comes back.
  const [anyPath, setAnyPath] = useState(true)
  const [grantError, setGrantError] = useState<string | null>(null)
  // Bumped to probe the typed path again once access may have changed.
  const [recheck, setRecheck] = useState(0)

  useEffect(() => {
    void tauriAdapter.environment().then(
      (env) => {
        setEnv(env)
        setAnyPath(env.canUseAnyPath)
      },
      () => setEnv(null),
    )
  }, [])

  // Settings reports nothing back, so the answer is asked for when aprinote is
  // in front again — which is when the user has come back from granting it.
  useEffect(() => {
    if (anyPath) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void tauriAdapter.anyPathAccess().then((granted) => {
        setAnyPath(granted)
        if (granted) setRecheck((n) => n + 1)
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [anyPath])

  // Probing is a write-and-delete in a directory the user is still typing the
  // name of, so it waits for them to stop.
  useEffect(() => {
    const candidate = path.trim()
    if (!candidate) return setProbe(null)

    const timer = setTimeout(() => {
      void tauriAdapter.probe(candidate).then(setProbe, () => setProbe(null))
    }, 350)
    return () => clearTimeout(timer)
  }, [path, recheck])

  const grant = () => {
    setGrantError(null)
    tauriAdapter.grantAnyPathAccess().catch((error: unknown) => {
      setGrantError(error instanceof Error ? error.message : String(error))
    })
  }

  if (!env) {
    return (
      <div className={styles.actions}>
        <button className={styles.primary} disabled>
          <Loader2 size={16} />
          Starting…
        </button>
      </div>
    )
  }

  const candidate = path.trim()

  return (
    <>
      <div className={styles.actions}>
        <button className={styles.primary} onClick={() => void open()} disabled={opening}>
          <FolderOpen size={16} />
          {opening ? 'Opening…' : env.canPickFolder ? 'Choose a vault folder' : 'Open my vault'}
        </button>

        {!env.canPickFolder && !elsewhere && (
          <button className={styles.secondary} onClick={() => setElsewhere(true)}>
            Use another folder
          </button>
        )}
      </div>

      {!env.canPickFolder && elsewhere && (
        <div className={styles.pathBox}>
          <label className={styles.pathLabel} htmlFor="vault-path">
            Full path to the folder
          </label>
          <div className={styles.pathRow}>
            <input
              id="vault-path"
              className={styles.pathInput}
              value={path}
              placeholder="/storage/emulated/0/notes"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setPath(event.target.value)}
            />
            <button
              className={styles.pathGo}
              disabled={!candidate || opening || probe?.usable === false}
              onClick={() => void openAt(candidate)}
            >
              Open
            </button>
          </div>

          {/* Said before anything is typed, because it is true of every path
              outside the app's own folder and takes a trip to Settings to fix. */}
          {!anyPath && !probe?.note && (
            <p className={styles.pathHint}>
              A folder outside aprinote’s own needs “All files access”, which Android grants in
              Settings.
            </p>
          )}
          {probe?.note && (
            <p className={styles.pathWarning}>
              <TriangleAlert size={13} />
              <span>{probe.note}</span>
            </p>
          )}
          {/* Android is the only platform with something to grant; the button
              goes once the grant is seen. */}
          {!anyPath && env.os === 'android' && (
            <button className={styles.grant} onClick={grant}>
              <ShieldCheck size={14} />
              Allow all files access
            </button>
          )}
          {grantError && (
            <p className={styles.pathWarning}>
              <TriangleAlert size={13} />
              <span>
                {grantError} Turn it on by hand: Settings › Apps › Special app access › All files
                access › aprinote.
              </span>
            </p>
          )}
          {probe?.usable && !probe.exists && (
            <p className={styles.pathHint}>This folder does not exist yet — opening creates it.</p>
          )}
        </div>
      )}

      <p className={styles.note}>
        {env.canPickFolder ? (
          'aprinote keeps the vault in a folder you can see. Your notes are the website.'
        ) : (
          <>
            Your vault lives at <code className={styles.path}>{env.defaultRoot}</code> — reachable
            over USB, and gone if you uninstall the app. A folder elsewhere on the phone keeps your
            notes independent of aprinote, and needs “All files access” granted to it once.
          </>
        )}
      </p>
    </>
  )
}
