import { useEffect, useState } from 'react'
import { Layers, Trash2, X } from 'lucide-react'
import type { FormatState } from '@/editor/EditorSurface'
import { EMPTY_STATE, sameColor } from '@/editor/commands/state'
import { useEditor } from '@/store/editorStore'
import { useSession } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import { BACKGROUND_PALETTE, TEXT_PALETTE, swatches } from '@/vault/palette'
import { EmbedPanel, ImagePanel, TablePanel } from './BlockPanels'
import styles from './Inspector.module.css'

const BLOCKS = ['h1', 'h2', 'h3', 'h4', 'p'] as const

const COLUMN_COUNTS = [1, 2, 3, 4] as const

const ATOM_TITLE = { image: 'Image', table: 'Table', embed: 'Embed' } as const

export function Inspector() {
  const toggleInspector = useSession((s) => s.toggleInspector)
  const surface = useEditor((s) => s.surface)
  const page = useVault((s) => s.page)
  const backlinks = useVault((s) => s.index?.backlinks)
  const palette = useVault((s) => s.settings.palette)
  const textColors = swatches(palette.text, TEXT_PALETTE)
  const backgroundColors = swatches(palette.background, BACKGROUND_PALETTE)
  const [state, setState] = useState<FormatState>(EMPTY_STATE)

  const inbound = page ? (backlinks?.get(page.meta.id)?.length ?? 0) : 0

  useEffect(() => {
    if (!surface) return setState(EMPTY_STATE)
    const sync = () => setState(surface.queryState())
    sync()
    return surface.on('selection', sync)
  }, [surface])

  const styleRules = page?.pageStyle.split('\n').filter((l) => l.includes('{')).length ?? 0
  const run = (command: string, args?: unknown) => () => surface?.exec(command, args)
  const keepSelection = (event: React.MouseEvent) => event.preventDefault()

  /**
   * A callout's own colour, written as an inline background so it travels with
   * the file — a class would only show in vaults whose stylesheet happens to have
   * the rule, and these are ordinary HTML documents people take elsewhere.
   */
  const tone = (value: string | null) =>
    run('styleBlock', { selector: '.callout', property: 'background-color', value })

  const title =
    state.picked > 0
      ? `${state.picked} block${state.picked === 1 ? '' : 's'}`
      : state.atom
        ? ATOM_TITLE[state.atom]
        : 'Text block'

  return (
    <div className={styles.inspector} onMouseDown={keepSelection}>
      <div className={styles.head}>
        <Layers size={14} />
        <span>{title}</span>
        <button className={styles.close} onClick={toggleInspector} title="Close inspector">
          <X size={14} />
        </button>
      </div>

      <div className={styles.body}>
        {/* A marquee selection speaks for the whole page, so it takes the panel:
            the controls below act on one block and would be lying about which. */}
        {state.picked > 0 && (
          <div>
            <div className={styles.label}>Selection</div>
            <div className={styles.blocks}>
              <button className={styles.blockBtn} onClick={run('removeBlocks')}>
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </div>
        )}

        {state.picked === 0 && state.atom && surface && (
          <>
            {state.atom === 'image' && <ImagePanel surface={surface} />}
            {state.atom === 'table' && <TablePanel surface={surface} />}
            {state.atom === 'embed' && <EmbedPanel surface={surface} />}
          </>
        )}

        {state.picked === 0 && !state.atom && (
          <>
        {state.callout && (
          <div>
            <div className={styles.label}>Callout</div>
            <div className={`${styles.swatches} ${styles.tones}`}>
              {backgroundColors.map(({ hex, name }) => (
                <button
                  key={hex}
                  className={`${styles.swatch} ${
                    sameColor(state.calloutColor, hex) ? styles.on : ''
                  }`}
                  style={{ background: hex }}
                  onClick={tone(hex)}
                  title={name}
                />
              ))}
              <button
                className={`${styles.clear} ${state.calloutColor ? '' : styles.on}`}
                onClick={tone(null)}
                title="The stylesheet's own colour"
              >
                ⨯
              </button>
            </div>
          </div>
        )}

        {state.columns > 0 && (
          <div>
            <div className={styles.label}>Columns</div>
            <div className={styles.blocks}>
              {COLUMN_COUNTS.map((count) => (
                <button
                  key={count}
                  className={`${styles.blockBtn} ${state.columns === count ? styles.on : ''}`}
                  onClick={run('setColumns', count)}
                  title={
                    count === 1
                      ? 'Dissolve the layout, keeping its blocks'
                      : `${count} columns — blocks from removed columns move into the last one`
                  }
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className={styles.label}>Block</div>
          <div className={styles.blocks}>
            {BLOCKS.map((tag) => (
              <button
                key={tag}
                className={`${styles.blockBtn} ${state.block === tag ? styles.on : ''}`}
                onClick={run('block', tag)}
              >
                {tag.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className={styles.label}>Text color</div>
          <div className={styles.swatches}>
            {textColors.map(({ hex, name }) => (
              <button
                key={hex}
                className={`${styles.swatch} ${sameColor(state.color, hex) ? styles.on : ''}`}
                style={{ background: hex }}
                onClick={run('color', hex)}
                title={name}
                disabled={state.collapsed}
              />
            ))}
          </div>
        </div>

        <div>
          <div className={styles.label}>Background</div>
          <div className={styles.swatches}>
            {backgroundColors.map(({ hex, name }) => (
              <button
                key={hex}
                className={`${styles.swatch} ${sameColor(state.background, hex) ? styles.on : ''}`}
                style={{ background: hex }}
                onClick={run('background', hex)}
                title={name}
                disabled={state.collapsed}
              />
            ))}
          </div>
        </div>

          </>
        )}

        <div className={styles.section}>
          <div className={styles.label}>Page</div>
          <div className={styles.rows}>
            <div className={styles.row}>
              <span>Path</span>
              <b>{page?.meta.path ?? '—'}</b>
            </div>
            <div className={styles.row}>
              <span>Stable id</span>
              <b>{page && !page.meta.id.startsWith('path:') ? page.meta.id : '—'}</b>
            </div>
            <div className={styles.row}>
              <span>Inbound links</span>
              <b>{inbound}</b>
            </div>
            <div className={styles.row}>
              <span>Own &lt;style&gt;</span>
              <b>
                {styleRules} rule{styleRules === 1 ? '' : 's'}
              </b>
            </div>
          </div>
        </div>

        <div className={styles.hint}>
          {state.picked > 0
            ? 'Drag any handle in the gutter to move these together, Backspace to remove them, Escape to deselect. Shift-drag another box to add more.'
            : state.atom
              ? 'Press Escape to deselect, Backspace to remove the block.'
              : state.collapsed
                ? 'Type / for blocks, or drag a box in the margin to pick several.'
                : 'Formatting applies to the current selection.'}
        </div>
      </div>
    </div>
  )
}
