import { useEffect, useState } from 'react'
import { registerCommands } from '@/editor/commands'
import { useEditor } from '@/store/editorStore'
import { useSession } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import { useChromeFit } from './useChromeFit'
import { Sidebar } from './Sidebar'
import { Rail } from './Rail'
import { TopBar } from './TopBar'
import { DocPane } from './DocPane'
import { SourcePane } from './SourcePane'
import { PreviewPane } from './PreviewPane'
import { Inspector } from './Inspector'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'
import { MobileBar } from './MobileBar'
import { CommandPalette } from './CommandPalette'
import { Settings } from './Settings'
import { StylesheetPane } from './StylesheetPane'
import { VaultGate } from './VaultGate'
import styles from './Shell.module.css'

registerCommands()

export function Shell() {
  const mode = useSession((s) => s.mode)
  const inspectorOpen = useSession((s) => s.inspectorOpen)
  const sidebarOpen = useSession((s) => s.sidebarOpen)
  const drawerOpen = useSession((s) => s.drawerOpen)
  const setDrawer = useSession((s) => s.setDrawer)
  const fit = useChromeFit(mode, inspectorOpen, sidebarOpen)
  const status = useVault((s) => s.status)
  const save = useVault((s) => s.save)
  const stylesheet = useVault((s) => s.stylesheet)
  const surface = useEditor((s) => s.surface)
  const requestImage = useEditor((s) => s.requestImage)

  const [palette, setPalette] = useState(false)
  const [settings, setSettings] = useState(false)

  /**
   * A pending autosave must not be lost to a closing tab — or, on a phone, to
   * the app being put in the background. Android kills backgrounded apps
   * whenever it likes and `beforeunload` never fires when it does, so the last
   * moment anything is guaranteed to run is the window going hidden.
   */
  useEffect(() => {
    const flush = () => void save()
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [save])

  /**
   * ⌘K means "link this" over a selection and "find anything" otherwise. The link
   * dialog is the document pane's; this only opens the palette when there is
   * nothing selected to link.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      if (surface && !surface.queryState().collapsed) return
      event.preventDefault()
      setPalette(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [surface])

  // The drawer belongs to the phone layout; resizing back to desktop closes it.
  useEffect(() => {
    if (!fit.mobile && drawerOpen) setDrawer(false)
  }, [fit.mobile, drawerOpen, setDrawer])

  if (status !== 'ready') return <VaultGate />

  const panes = stylesheet ? (
    /* There is no WYSIWYG for a stylesheet — Source, or Preview of the page that
       was open, under the last saved CSS. */
    mode === 'preview' ? (
      <PreviewPane />
    ) : (
      <StylesheetPane />
    )
  ) : mode === 'preview' ? (
    <PreviewPane />
  ) : (
    <>
      <DocPane />
      {mode === 'split' && <SourcePane />}
    </>
  )

  return (
    <div className={styles.shell}>
      <TitleBar />
      <div className={styles.body}>
        {!fit.mobile && (fit.sidebar ? <Sidebar /> : <Rail />)}

        {fit.mobile && drawerOpen && (
          <>
            <div className={styles.scrim} onClick={() => setDrawer(false)} />
            <div className={styles.drawer}>
              <Sidebar />
            </div>
          </>
        )}

        <div className={styles.main}>
          <TopBar mobile={fit.mobile} onSearch={() => setPalette(true)} />
          <div className={styles.panes}>
            {panes}
            {fit.inspector && !stylesheet && <Inspector />}
          </div>
          {fit.mobile && mode === 'edit' && !stylesheet && (
            <MobileBar onPickImage={() => requestImage?.()} />
          )}
          <StatusBar />
        </div>
      </div>

      {palette && (
        <CommandPalette onClose={() => setPalette(false)} onOpenSettings={() => setSettings(true)} />
      )}
      {settings && <Settings onClose={() => setSettings(false)} />}
    </div>
  )
}
