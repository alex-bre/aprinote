import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Columns3,
  Rows3,
  Trash2,
} from 'lucide-react'
import { hasHeaderColumn, hasHeaderRow } from '@/editor/table/ops'
import type { EditorSurface } from '@/editor/EditorSurface'
import styles from './Inspector.module.css'

/**
 * Inspector panels for a selected image, table or embed. Every control goes
 * through `surface.exec`, so the same command layer serves these, the floating bar
 * and the slash menu.
 */

type Exec = EditorSurface['exec']

const MAX_WIDTHS = ['100%', '680px', '520px', '360px']

/** Read a property straight off the selected element. */
function useSelected(surface: EditorSurface | null): HTMLElement | null {
  return surface?.selectedAtom() ?? null
}

export function ImagePanel({ surface }: { surface: EditorSurface }) {
  const figure = useSelected(surface)
  const image = figure?.querySelector('img')
  const exec: Exec = (command, args) => surface.exec(command, args)

  const maxWidth = figure?.style.maxWidth || '100%'
  const align = figure?.style.marginInline === 'auto'
    ? 'center'
    : figure?.style.marginLeft === 'auto'
      ? 'right'
      : 'left'

  const setAlign = (value: 'left' | 'center' | 'right') => () => {
    exec('styleBlock', { selector: 'figure', property: 'margin-inline', value: null })
    exec('styleBlock', { selector: 'figure', property: 'margin-left', value: null })
    if (value === 'center') {
      exec('styleBlock', { selector: 'figure', property: 'margin-inline', value: 'auto' })
    } else if (value === 'right') {
      exec('styleBlock', { selector: 'figure', property: 'margin-left', value: 'auto' })
    }
  }

  return (
    <>
      <div>
        <div className={styles.label}>Max width</div>
        <div className={styles.blocks}>
          {MAX_WIDTHS.map((value) => (
            <button
              key={value}
              className={`${styles.blockBtn} ${maxWidth === value ? styles.on : ''}`}
              onClick={() =>
                exec('styleBlock', {
                  selector: 'figure',
                  property: 'max-width',
                  value: value === '100%' ? null : value,
                })
              }
            >
              {value === '100%' ? 'Full' : value.replace('px', '')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={styles.label}>Alignment</div>
        <div className={styles.blocks}>
          <button
            className={`${styles.blockBtn} ${align === 'left' ? styles.on : ''}`}
            onClick={setAlign('left')}
            title="Align left"
          >
            <AlignLeft size={14} />
          </button>
          <button
            className={`${styles.blockBtn} ${align === 'center' ? styles.on : ''}`}
            onClick={setAlign('center')}
            title="Centre"
          >
            <AlignCenter size={14} />
          </button>
          <button
            className={`${styles.blockBtn} ${align === 'right' ? styles.on : ''}`}
            onClick={setAlign('right')}
            title="Align right"
          >
            <AlignRight size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className={styles.label}>Aspect ratio</div>
        <div className={styles.blocks}>
          {['auto', '16 / 9', '4 / 3', '1 / 1'].map((value) => (
            <button
              key={value}
              className={`${styles.blockBtn} ${
                (image?.style.aspectRatio || 'auto') === value ? styles.on : ''
              }`}
              onClick={() =>
                exec('styleBlock', {
                  selector: 'img',
                  property: 'aspect-ratio',
                  value: value === 'auto' ? null : value,
                })
              }
            >
              {value === 'auto' ? 'Auto' : value.replace(/\s/g, '')}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className={styles.label}>Alt text</div>
        <input
          className={styles.input}
          value={image?.getAttribute('alt') ?? ''}
          placeholder="Describe the image"
          onChange={(event) =>
            exec('setAttribute', { selector: 'img', name: 'alt', value: event.target.value })
          }
        />
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={image?.getAttribute('loading') === 'lazy'}
          onChange={(event) =>
            exec('setAttribute', {
              selector: 'img',
              name: 'loading',
              value: event.target.checked ? 'lazy' : null,
            })
          }
        />
        Lazy load
      </label>
    </>
  )
}

export function TablePanel({ surface }: { surface: EditorSurface }) {
  const table = useSelected(surface) as HTMLTableElement | null
  const exec: Exec = (command, args) => surface.exec(command, args)
  const sized = !!table?.querySelector('colgroup')

  return (
    <>
      <div>
        <div className={styles.label}>Rows</div>
        <div className={styles.blocks}>
          <button className={styles.blockBtn} onClick={() => exec('table.insertRowAbove')}>
            <Rows3 size={14} /> Above
          </button>
          <button className={styles.blockBtn} onClick={() => exec('table.insertRowBelow')}>
            <Rows3 size={14} /> Below
          </button>
          <button className={styles.blockBtn} onClick={() => exec('table.deleteRow')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className={styles.label}>Columns</div>
        <div className={styles.blocks}>
          <button className={styles.blockBtn} onClick={() => exec('table.insertColumnBefore')}>
            <Columns3 size={14} /> Before
          </button>
          <button className={styles.blockBtn} onClick={() => exec('table.insertColumnAfter')}>
            <Columns3 size={14} /> After
          </button>
          <button className={styles.blockBtn} onClick={() => exec('table.deleteColumn')}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div>
        <div className={styles.label}>Widths</div>
        <div className={styles.blocks}>
          <button
            className={styles.blockBtn}
            disabled={!sized}
            onClick={() => exec('table.distributeColumns')}
          >
            <Columns3 size={14} /> Even
          </button>
        </div>
      </div>

      <label className={styles.check}>
        <input
          type="checkbox"
          checked={!!table && hasHeaderRow(table)}
          onChange={() => exec('table.toggleHeaderRow')}
        />
        Header row
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={!!table && hasHeaderColumn(table)}
          onChange={() => exec('table.toggleHeaderColumn')}
        />
        Header column
      </label>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={table?.classList.contains('zebra') ?? false}
          onChange={() => exec('table.toggleZebra')}
        />
        Zebra stripes
      </label>
      <div className={styles.hint}>
        Hover a table to reorder its rows and columns, drag a column edge to resize,
        and use the <b>+</b> below or beside it to add one.
      </div>
    </>
  )
}

export function EmbedPanel({ surface }: { surface: EditorSurface }) {
  const figure = useSelected(surface)
  const frame = figure?.querySelector('iframe')
  const exec: Exec = (command, args) => surface.exec(command, args)

  return (
    <>
      <div>
        <div className={styles.label}>Embed URL</div>
        <input
          className={styles.input}
          value={frame?.getAttribute('src') ?? ''}
          onChange={(event) =>
            exec('setAttribute', { selector: 'iframe', name: 'src', value: event.target.value })
          }
        />
      </div>
      <div>
        <div className={styles.label}>Height</div>
        <div className={styles.blocks}>
          {['240px', '360px', '480px'].map((value) => (
            <button
              key={value}
              className={`${styles.blockBtn} ${frame?.style.height === value ? styles.on : ''}`}
              onClick={() =>
                exec('styleBlock', { selector: 'iframe', property: 'height', value })
              }
            >
              {value.replace('px', '')}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.hint}>
        Embeds are inert while editing. Preview renders the live frame in its sandbox.
      </div>
    </>
  )
}
