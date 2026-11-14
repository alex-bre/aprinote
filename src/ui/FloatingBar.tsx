import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Palette,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from 'lucide-react'
import type { FormatState } from '@/editor/EditorSurface'
import { EMPTY_STATE, sameColor } from '@/editor/commands/state'
import { useEditor } from '@/store/editorStore'
import { useVault } from '@/store/vaultStore'
import { BACKGROUND_PALETTE, TEXT_PALETTE, swatches } from '@/vault/palette'
import styles from './FloatingBar.module.css'

const BLOCKS = [
  { tag: 'h1', label: 'H1' },
  { tag: 'h2', label: 'H2' },
  { tag: 'h3', label: 'H3' },
  { tag: 'h4', label: 'H4' },
  { tag: 'p', label: 'P' },
] as const

const ALIGNMENTS = [
  { value: 'left', Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right', Icon: AlignRight },
  { value: 'justify', Icon: AlignJustify },
] as const

const GAP = 10

/**
 * The selection toolbar. It never takes focus — every button suppresses mousedown
 * so the selection it is acting on survives the click.
 */
export function FloatingBar({ bounds }: { bounds?: React.RefObject<HTMLElement | null> }) {
  const surface = useEditor((s) => s.surface)
  // Colours come from the vault's own palette, editable in Settings.
  const palette = useVault((s) => s.settings.palette)
  const textColors = swatches(palette.text, TEXT_PALETTE)
  const backgroundColors = swatches(palette.background, BACKGROUND_PALETTE)
  const [state, setState] = useState<FormatState>(EMPTY_STATE)
  const [colorsOpen, setColorsOpen] = useState(false)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const bar = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!surface) return setState(EMPTY_STATE)
    const sync = () => setState(surface.queryState())
    sync()
    return surface.on('selection', sync)
  }, [surface])

  const visible = !state.collapsed && !!state.rect

  useEffect(() => {
    if (!visible) setColorsOpen(false)
  }, [visible])

  useLayoutEffect(() => {
    const rect = state.rect
    const node = bar.current
    if (!rect || !node) return

    const box = node.getBoundingClientRect()
    const limit = bounds?.current?.getBoundingClientRect()
    const minLeft = Math.max(8, limit?.left ?? 0)
    const maxLeft = Math.min(window.innerWidth, limit?.right ?? window.innerWidth) - box.width - 8

    const left = Math.round(
      Math.min(Math.max(minLeft, rect.left + rect.width / 2 - box.width / 2), Math.max(minLeft, maxLeft)),
    )
    // Above the selection, or below it when that would overlap the app chrome.
    const above = rect.top - box.height - GAP
    const ceiling = (limit?.top ?? 0) + 8
    setAt({ left, top: Math.round(above < ceiling ? rect.bottom + GAP : above) })
  }, [state.rect, colorsOpen, bounds])

  if (!surface || !visible) return null

  const run = (command: string, args?: unknown) => () => surface.exec(command, args)
  const keepSelection = (event: React.MouseEvent) => event.preventDefault()

  const setLink = () => {
    const href = window.prompt('Link to', state.link ?? 'https://')
    if (href === null) return
    surface.exec('link', href.trim() || null)
  }

  return (
    <div
      className={styles.bar}
      ref={bar}
      style={at}
      role="toolbar"
      aria-label="Formatting"
      onMouseDown={keepSelection}
    >
      <div className={styles.row}>
        {BLOCKS.map(({ tag, label }) => (
          <button
            key={tag}
            className={`${styles.btn} ${styles.block} ${state.block === tag ? styles.on : ''}`}
            onClick={run('block', tag)}
            title={label === 'P' ? 'Paragraph' : `Heading ${label[1]}`}
          >
            {label}
          </button>
        ))}

        <span className={styles.rule} />

        <button
          className={`${styles.btn} ${state.bold ? styles.on : ''}`}
          onClick={run('bold')}
          title="Bold (⌘B)"
        >
          <Bold size={15} />
        </button>
        <button
          className={`${styles.btn} ${state.italic ? styles.on : ''}`}
          onClick={run('italic')}
          title="Italic (⌘I)"
        >
          <Italic size={15} />
        </button>
        <button
          className={`${styles.btn} ${state.underline ? styles.on : ''}`}
          onClick={run('underline')}
          title="Underline (⌘U)"
        >
          <Underline size={15} />
        </button>
        <button
          className={`${styles.btn} ${state.strikethrough ? styles.on : ''}`}
          onClick={run('strikethrough')}
          title="Strikethrough"
        >
          <Strikethrough size={15} />
        </button>

        <span className={styles.rule} />

        {ALIGNMENTS.map(({ value, Icon }) => (
          <button
            key={value}
            className={`${styles.btn} ${state.align === value ? styles.on : ''}`}
            onClick={run('align', value)}
            title={`Align ${value}`}
          >
            <Icon size={15} />
          </button>
        ))}

        <span className={styles.rule} />

        <button
          className={`${styles.btn} ${state.list === 'ul' ? styles.on : ''}`}
          onClick={run('list', 'ul')}
          title="Bulleted list"
        >
          <List size={15} />
        </button>
        <button
          className={`${styles.btn} ${state.list === 'ol' ? styles.on : ''}`}
          onClick={run('list', 'ol')}
          title="Numbered list"
        >
          <ListOrdered size={15} />
        </button>

        <span className={styles.rule} />

        <button
          className={`${styles.btn} ${colorsOpen ? styles.on : ''}`}
          onClick={() => setColorsOpen((open) => !open)}
          title="Colour"
        >
          <Palette size={15} />
        </button>
        <button
          className={`${styles.btn} ${state.link ? styles.on : ''}`}
          onClick={setLink}
          title="Link (⌘K)"
        >
          <Link2 size={15} />
        </button>
        {state.link && (
          <button className={styles.btn} onClick={run('link', null)} title="Remove link">
            <Link2Off size={15} />
          </button>
        )}
        <button className={styles.btn} onClick={run('clearFormatting')} title="Clear formatting">
          <RemoveFormatting size={15} />
        </button>
      </div>

      {colorsOpen && (
        <div className={styles.colors}>
          <div className={styles.label}>Text</div>
          <div className={styles.swatches}>
            {textColors.map(({ hex, name }) => (
              <button
                key={hex}
                className={`${styles.swatch} ${sameColor(state.color, hex) ? styles.picked : ''}`}
                style={{ background: hex }}
                onClick={run('color', hex)}
                title={name}
              />
            ))}
            <button className={styles.clear} onClick={run('color', null)} title="Default colour">
              ⨯
            </button>
          </div>

          <div className={styles.label}>Background</div>
          <div className={styles.swatches}>
            {backgroundColors.map(({ hex, name }) => (
              <button
                key={hex}
                className={`${styles.swatch} ${sameColor(state.background, hex) ? styles.picked : ''}`}
                style={{ background: hex }}
                onClick={run('background', hex)}
                title={name}
              />
            ))}
            <button className={styles.clear} onClick={run('background', null)} title="No background">
              ⨯
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
