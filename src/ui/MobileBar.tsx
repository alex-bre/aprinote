import { useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
} from 'lucide-react'
import type { FormatState } from '@/editor/EditorSurface'
import { EMPTY_STATE } from '@/editor/commands/state'
import { useEditor } from '@/store/editorStore'
import styles from './MobileBar.module.css'

/**
 * The phone's formatting toolbar.
 *
 * Docked above the keyboard rather than floating, because a floating bar over a
 * selection is unreachable one-handed and fights the OS selection handles. It
 * scrolls horizontally; every target is at least 34px. It drives the same command
 * layer as the desktop floating bar — this is a different container, not a
 * different editor.
 */
export function MobileBar({ onPickImage }: { onPickImage: () => void }) {
  const surface = useEditor((s) => s.surface)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const [state, setState] = useState<FormatState>(EMPTY_STATE)
  const bar = useRef<HTMLDivElement>(null)

  /**
   * Keep the keyboard up and the selection alive when a button is tapped. React
   * registers `touchstart` as passive, where `preventDefault` is a no-op that
   * also warns — so this one has to be a native non-passive listener.
   */
  useEffect(() => {
    const node = bar.current
    if (!node) return
    const swallow = (event: TouchEvent) => event.preventDefault()
    node.addEventListener('touchstart', swallow, { passive: false })
    return () => node.removeEventListener('touchstart', swallow)
  }, [])

  useEffect(() => {
    if (!surface) return setState(EMPTY_STATE)
    const sync = () => setState(surface.queryState())
    sync()
    return surface.on('selection', sync)
  }, [surface])

  if (!surface) return null

  const run = (command: string, args?: unknown) => () => surface.exec(command, args)
  const blocks = ['h1', 'h2', 'h3', 'p'] as const

  return (
    <div
      className={styles.bar}
      ref={bar}
      role="toolbar"
      aria-label="Formatting"
      // Never take focus — the keyboard must stay up and the selection must survive.
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className={styles.scroller}>
        <button className={styles.btn} onClick={() => surface.undo()} disabled={!canUndo} title="Undo">
          <Undo2 size={17} />
        </button>
        <button className={styles.btn} onClick={() => surface.redo()} disabled={!canRedo} title="Redo">
          <Redo2 size={17} />
        </button>
        <span className={styles.rule} />

        {blocks.map((tag) => (
          <button
            key={tag}
            className={`${styles.btn} ${styles.text} ${state.block === tag ? styles.on : ''}`}
            onClick={run('block', tag)}
          >
            {tag.toUpperCase()}
          </button>
        ))}
        <span className={styles.rule} />

        <button className={`${styles.btn} ${state.bold ? styles.on : ''}`} onClick={run('bold')} title="Bold">
          <Bold size={17} />
        </button>
        <button className={`${styles.btn} ${state.italic ? styles.on : ''}`} onClick={run('italic')} title="Italic">
          <Italic size={17} />
        </button>
        <button
          className={`${styles.btn} ${state.underline ? styles.on : ''}`}
          onClick={run('underline')}
          title="Underline"
        >
          <Underline size={17} />
        </button>
        <button
          className={`${styles.btn} ${state.strikethrough ? styles.on : ''}`}
          onClick={run('strikethrough')}
          title="Strikethrough"
        >
          <Strikethrough size={17} />
        </button>
        <span className={styles.rule} />

        <button
          className={`${styles.btn} ${state.list === 'ul' ? styles.on : ''}`}
          onClick={run('list', 'ul')}
          title="Bulleted list"
        >
          <List size={17} />
        </button>
        <button
          className={`${styles.btn} ${state.list === 'ol' ? styles.on : ''}`}
          onClick={run('list', 'ol')}
          title="Numbered list"
        >
          <ListOrdered size={17} />
        </button>
        <span className={styles.rule} />

        {(
          [
            ['left', AlignLeft],
            ['center', AlignCenter],
            ['right', AlignRight],
          ] as const
        ).map(([value, Icon]) => (
          <button
            key={value}
            className={`${styles.btn} ${state.align === value ? styles.on : ''}`}
            onClick={run('align', value)}
            title={`Align ${value}`}
          >
            <Icon size={17} />
          </button>
        ))}
        <span className={styles.rule} />

        <button
          className={`${styles.btn} ${state.link ? styles.on : ''}`}
          onClick={() => {
            const href = window.prompt('Link to', state.link ?? 'https://')
            if (href !== null) surface.exec('link', href.trim() || null)
          }}
          title="Link"
        >
          <Link2 size={17} />
        </button>
        <button className={styles.btn} onClick={onPickImage} title="Image">
          <ImageIcon size={17} />
        </button>
        <button className={styles.btn} onClick={run('table')} title="Table">
          <TableIcon size={17} />
        </button>
        <button className={styles.btn} onClick={run('block', 'blockquote')} title="Quote">
          <Quote size={17} />
        </button>
        <button className={styles.btn} onClick={run('callout')} title="Callout">
          <Plus size={17} />
        </button>
        <button className={styles.btn} onClick={run('divider')} title="Divider">
          <Minus size={17} />
        </button>
      </div>
    </div>
  )
}
