import { useEffect } from 'react'
import { Check, Paintbrush, X } from 'lucide-react'
import { useVault } from '@/store/vaultStore'
import { LazyCodeEditor } from './LazyCodeEditor'
import styles from './SourcePane.module.css'
import own from './StylesheetPane.module.css'

/**
 * The vault stylesheet editor.
 *
 * The one document in the app that is **not** autosaved. Saving is a discrete act
 * (⌘S) because saving is also what *applies* the stylesheet — so a half-written
 * selector never repaints the document under you mid-keystroke.
 */
export function StylesheetPane() {
  const stylesheet = useVault((s) => s.stylesheet)
  const editStylesheet = useVault((s) => s.editStylesheet)
  const saveStylesheet = useVault((s) => s.saveStylesheet)
  const closeStylesheet = useVault((s) => s.closeStylesheet)

  const dirty = !!stylesheet && stylesheet.text !== stylesheet.saved

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveStylesheet()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveStylesheet])

  if (!stylesheet) return null

  return (
    <div className={styles.pane} style={{ maxWidth: 'none' }}>
      <div className={styles.head}>
        <Paintbrush size={14} />
        <span className={own.path}>_vault/site.css</span>

        <span className={own.actions}>
          <span className={`${own.state} ${dirty ? own.dirty : own.clean}`}>
            {dirty ? 'unsaved — ⌘S applies it' : (
              <>
                <Check size={12} /> applied
              </>
            )}
          </span>
          <button
            className={own.save}
            onClick={() => void saveStylesheet()}
            disabled={!dirty}
            title="Save and apply (⌘S)"
          >
            Save
          </button>
          <button className={own.close} onClick={closeStylesheet} title="Back to the page">
            <X size={14} />
          </button>
        </span>
      </div>

      <LazyCodeEditor
        className={styles.code}
        value={stylesheet.text}
        language="css"
        onChange={editStylesheet}
      />

      <div className={styles.foot}>
        <span>{stylesheet.text.split('\n').length} lines</span>
        <span>{(stylesheet.text.match(/\{/g) ?? []).length} rules</span>
        <span>applied on save, never as you type</span>
      </div>
    </div>
  )
}
