import { useCallback, useEffect, useRef, useState } from 'react'
import { CodeXml, FileCode2, RefreshCw } from 'lucide-react'
import { useEditor } from '@/store/editorStore'
import { useSession } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import { LazyCodeEditor } from './LazyCodeEditor'
import styles from './SourcePane.module.css'

/**
 * Split-pane sync.
 *
 * Because the DOM *is* the model, this is nearly free in both directions:
 * WYSIWYG → source is the pretty-printed live DOM, and source → WYSIWYG assigns
 * `innerHTML` and restores the caret by path. No loss guard, no
 * normalised-comparison warning bar, no divergence to reconcile.
 *
 * The one thing still needed is a debounce, so the caret does not fight the
 * reparse while you type. That is ergonomics, not correctness.
 */

const SYNC_MS = 500

export function SourcePane() {
  const page = useVault((s) => s.page)
  const revision = useVault((s) => s.revision)
  const editDocument = useVault((s) => s.editDocument)
  const surface = useEditor((s) => s.surface)
  const sourceMode = useSession((s) => s.sourceMode)
  const setSourceMode = useSession((s) => s.setSourceMode)

  const fullFile = sourceMode === 'document'
  const incoming = (fullFile ? page?.document : page?.fragment) ?? ''

  // Local text so typing is never interrupted by the round-trip back through
  // the store; the incoming value wins whenever the two diverge from outside.
  const [text, setText] = useState(incoming)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (dirty.current) return
    setText(incoming)
  }, [incoming, revision])

  // Switching views always adopts the other text — holding a pending edit here
  // would show the fragment's characters under the full file's heading.
  useEffect(() => {
    dirty.current = false
    setText(
      (sourceMode === 'document'
        ? useVault.getState().page?.document
        : useVault.getState().page?.fragment) ?? '',
    )
  }, [sourceMode])

  /** Land any pending edit before the view changes under it. */
  const switchMode = (next: 'fragment' | 'document') => {
    if (dirty.current) {
      clearTimeout(timer.current)
      flushRef.current?.()
    }
    setSourceMode(next)
  }

  const flush = useCallback(
    (value: string) => {
      dirty.current = false
      if (fullFile) editDocument(value)
      else surface?.setFragment(value)
    },
    [fullFile, editDocument, surface],
  )

  // `switchMode` is declared above `flush`, so it reaches it through a ref.
  const flushRef = useRef<(() => void) | null>(null)
  flushRef.current = () => flush(text)

  const onChange = useCallback(
    (value: string) => {
      setText(value)
      dirty.current = true
      clearTimeout(timer.current)
      timer.current = setTimeout(() => flush(value), SYNC_MS)
    },
    [flush],
  )

  const onBlur = useCallback(() => {
    if (!dirty.current) return
    clearTimeout(timer.current)
    flush(text)
  }, [flush, text])

  useEffect(() => () => clearTimeout(timer.current), [])

  const lines = text ? text.split('\n').length : 0
  const styleBlocks = page?.pageStyle.trim() ? 1 : 0
  const pageLinks = (text.match(/data-aprinote=/g) ?? []).length

  return (
    <div className={styles.pane}>
      <div className={styles.head}>
        <CodeXml size={14} />
        <div className={styles.toggle}>
          <button
            className={`${styles.mode} ${!fullFile ? styles.on : ''}`}
            onClick={() => switchMode('fragment')}
            title="Just the editable region"
          >
            fragment
          </button>
          <button
            className={`${styles.mode} ${fullFile ? styles.on : ''}`}
            onClick={() => switchMode('document')}
            title="The whole file, including <head> and this page's <style>"
          >
            full file
          </button>
        </div>
        <span className={styles.sync}>
          {dirty.current ? <RefreshCw size={11} /> : <span className={styles.dot} />}
          live sync
        </span>
      </div>

      <LazyCodeEditor className={styles.code} value={text} language="html" onChange={onChange} onBlur={onBlur} />

      <div className={styles.foot}>
        <span>{lines} lines</span>
        {fullFile && (
          <span>
            <FileCode2 size={11} /> head editable
          </span>
        )}
        <span>
          {styleBlocks} &lt;style&gt; block{styleBlocks === 1 ? '' : 's'}
        </span>
        <span>{pageLinks} page links</span>
      </div>
    </div>
  )
}
