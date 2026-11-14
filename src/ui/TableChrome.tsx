import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Columns3,
  Copy,
  Grid2x2,
  PanelLeft,
  PanelTop,
  Plus,
  Rows3,
  Trash2,
} from 'lucide-react'
import type { TableFrame } from '@/editor/EditorSurface'
import type { ColumnAlign, TableTarget } from '@/editor/table/ops'
import { useEditor } from '@/store/editorStore'
import { ContextMenu, type MenuAnchor, type MenuItem } from './ContextMenu'
import styles from './TableChrome.module.css'

/**
 * Table chrome: the handles, `+` bars and column-width grips that sit *around* a
 * table — Notion-style chrome, positioned from `getBoundingClientRect`.
 *
 * Like the block gutter it reads geometry through the editor port and writes
 * through commands, addressing the table by path and its rows and columns by
 * index. It never holds a node, so nothing here can outlive the DOM it describes,
 * and every edit it makes is undoable like any other.
 */

/** Thickness of a row or column handle. Bands are inset a pixel so they read apart. */
const HANDLE = 11
/** Space between the chrome and the table's edge. */
const GAP = 5
/** Thickness of the `+` bars that add a row or a column. */
const ADD = 16
/** How far outside the table the pointer still counts as "over" it. */
const PAD = 30
/** Movement, in pixels, before a press on a handle becomes a reorder drag. */
const SLOP = 4
/** No column may be dragged narrower than this share of the table. */
const MIN_SHARE = 0.06

type Axis = 'row' | 'column'

/** A press on a handle: a menu when it ends where it started, a move when not. */
interface Grab {
  axis: Axis
  from: number
  to: number
  dragging: boolean
  x: number
  y: number
}

/** A column-boundary drag. Widths are fractions; they land on release. */
interface Resize {
  index: number
  x: number
  widths: number[]
  moved: boolean
}

function sameBands(a: TableFrame['rows'], b: TableFrame['rows']): boolean {
  return a.length === b.length && a.every((band, i) => band.start === b[i].start && band.size === b[i].size)
}

function sameFrames(a: TableFrame[], b: TableFrame[]): boolean {
  return (
    a.length === b.length &&
    a.every((frame, i) => {
      const other = b[i]
      return (
        frame.top === other.top &&
        frame.left === other.left &&
        frame.width === other.width &&
        frame.height === other.height &&
        frame.headerRow === other.headerRow &&
        frame.headerColumn === other.headerColumn &&
        frame.zebra === other.zebra &&
        frame.sized === other.sized &&
        frame.active === other.active &&
        frame.path.join('.') === other.path.join('.') &&
        sameBands(frame.rows, other.rows) &&
        sameBands(frame.columns, other.columns)
      )
    })
  )
}

/** The innermost table under a point, with room for the chrome around it. */
function frameAt(frames: TableFrame[], x: number, y: number): number {
  let found = -1
  let smallest = Infinity
  frames.forEach((frame, index) => {
    if (x < frame.left - PAD || x > frame.left + frame.width + PAD) return
    if (y < frame.top - PAD || y > frame.top + frame.height + PAD) return
    const area = frame.width * frame.height
    if (area < smallest) {
      found = index
      smallest = area
    }
  })
  return found
}

/** The band a pointer offset falls in, clamped to the ends. */
function bandAt(bands: TableFrame['rows'], offset: number): number {
  for (let i = 0; i < bands.length; i++) {
    if (offset < bands[i].start + bands[i].size) return i
  }
  return Math.max(0, bands.length - 1)
}

export function TableChrome({
  host,
  bounds,
  onShow,
}: {
  /** The editor host element — the chrome aligns to its box, never inside it. */
  host: React.RefObject<HTMLElement | null>
  /** The scrolling pane both live in. */
  bounds: React.RefObject<HTMLElement | null>
  /** The table currently wearing chrome, so the gutter can yield the margin. */
  onShow?: (path: number[] | null) => void
}) {
  const surface = useEditor((s) => s.surface)
  const [frames, setFrames] = useState<TableFrame[]>([])
  const [origin, setOrigin] = useState({ top: 0, left: 0, width: 0 })
  const [hover, setHover] = useState(-1)
  /** Held open while a menu, a drag or a resize is in flight. */
  const [pinned, setPinned] = useState(-1)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [band, setBand] = useState<{ axis: Axis; index: number } | null>(null)
  const [grab, setGrab] = useState<Grab | null>(null)
  const [resize, setResize] = useState<Resize | null>(null)

  const frame = useRef(0)
  const state = useRef({ frames, grab })
  state.current = { frames, grab }

  const measure = useCallback(() => {
    const article = host.current
    if (!surface || !article) return
    const next = surface.tables()
    setFrames((previous) => (sameFrames(previous, next) ? previous : next))
    setOrigin((previous) => {
      const { offsetTop: top, offsetLeft: left } = article
      const width = bounds.current?.clientWidth ?? 0
      return previous.top === top && previous.left === left && previous.width === width
        ? previous
        : { top, left, width }
    })
  }, [surface, host, bounds])

  /** Coalesce the measurement — a keystroke and a selection change are one frame. */
  const sync = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    if (!surface) {
      setFrames([])
      return
    }
    sync()
    const offChange = surface.on('change', sync)
    const offSelection = surface.on('selection', sync)

    const article = host.current
    const observer = new ResizeObserver(sync)
    if (article) observer.observe(article)
    window.addEventListener('resize', sync)

    return () => {
      offChange()
      offSelection()
      observer.disconnect()
      window.removeEventListener('resize', sync)
      cancelAnimationFrame(frame.current)
    }
  }, [surface, sync, host])

  const localPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = host.current?.getBoundingClientRect()
      if (!rect) return null
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    [host],
  )

  // Hovering anywhere near a table brings its handles up, exactly as hovering a
  // block reveals its gutter grip.
  useEffect(() => {
    const pane = bounds.current
    if (!pane) return
    const onMove = (event: PointerEvent) => {
      if (state.current.grab) return
      const at = localPoint(event)
      setHover(at ? frameAt(state.current.frames, at.x, at.y) : -1)
    }
    const onLeave = () => !state.current.grab && setHover(-1)
    pane.addEventListener('pointermove', onMove)
    pane.addEventListener('pointerleave', onLeave)
    return () => {
      pane.removeEventListener('pointermove', onMove)
      pane.removeEventListener('pointerleave', onLeave)
    }
  }, [bounds, localPoint])

  // An index can outlive the frame it named — a table deleted while its menu is
  // open — so both are checked against the frames actually measured.
  const within = (at: number) => (at >= 0 && at < frames.length ? at : -1)
  const index = [within(pinned), within(hover), frames.findIndex((entry) => entry.active)].find(
    (at) => at >= 0,
  ) ?? -1
  const shown = frames[index] ?? null

  // The gutter draws its labels in the same margin these handles need, so it is
  // told which block to leave alone while they are up.
  const key = shown ? shown.path.join('.') : ''
  useEffect(() => {
    onShow?.(key ? key.split('.').map(Number) : null)
  }, [key, onShow])
  useEffect(() => () => onShow?.(null), [onShow])

  const run = useCallback(
    (command: string, args: TableTarget = {}) => {
      if (!shown) return
      surface?.exec(command, { path: shown.path, ...args })
    },
    [surface, shown],
  )

  const closeMenu = useCallback(() => {
    setMenu(null)
    setBand(null)
    setPinned(-1)
  }, [])

  // A table that goes away under an open menu takes the menu with it.
  useEffect(() => {
    if (!shown) closeMenu()
  }, [shown, closeMenu])

  // --- menus ----------------------------------------------------------------

  const columnMenu = (at: number): MenuItem[] => {
    const align = (value: ColumnAlign, label: string, Icon: MenuItem['Icon']) => ({
      label,
      Icon,
      onSelect: () => run('table.alignColumn', { column: at, align: value }),
    })
    return [
      { label: 'Insert column left', Icon: ArrowLeftToLine, onSelect: () => run('table.insertColumnBefore', { column: at }) },
      { label: 'Insert column right', Icon: ArrowRightToLine, onSelect: () => run('table.insertColumnAfter', { column: at }) },
      { label: 'Duplicate column', Icon: Copy, onSelect: () => run('table.duplicateColumn', { column: at }) },
      { rule: true, label: '' },
      align('left', 'Align left', AlignLeft),
      align('center', 'Align centre', AlignCenter),
      align('right', 'Align right', AlignRight),
      { rule: true, label: '' },
      {
        label: 'Delete column',
        Icon: Trash2,
        danger: true,
        disabled: (shown?.columns.length ?? 0) <= 1,
        onSelect: () => run('table.deleteColumn', { column: at }),
      },
    ]
  }

  const rowMenu = (at: number): MenuItem[] => [
    { label: 'Insert row above', Icon: ArrowUpToLine, onSelect: () => run('table.insertRowAbove', { row: at }) },
    { label: 'Insert row below', Icon: ArrowDownToLine, onSelect: () => run('table.insertRowBelow', { row: at }) },
    { label: 'Duplicate row', Icon: Copy, onSelect: () => run('table.duplicateRow', { row: at }) },
    { rule: true, label: '' },
    {
      label: 'Delete row',
      Icon: Trash2,
      danger: true,
      disabled: (shown?.rows.length ?? 0) <= 1,
      onSelect: () => run('table.deleteRow', { row: at }),
    },
  ]

  const tableMenu = (): MenuItem[] => [
    {
      label: shown?.headerRow ? 'Remove header row' : 'Header row',
      Icon: PanelTop,
      onSelect: () => run('table.toggleHeaderRow'),
    },
    {
      label: shown?.headerColumn ? 'Remove header column' : 'Header column',
      Icon: PanelLeft,
      onSelect: () => run('table.toggleHeaderColumn'),
    },
    {
      label: shown?.zebra ? 'Remove zebra stripes' : 'Zebra stripes',
      Icon: Rows3,
      onSelect: () => run('table.toggleZebra'),
    },
    { rule: true, label: '' },
    { label: 'Add row', Icon: Rows3, onSelect: () => run('table.appendRow') },
    { label: 'Add column', Icon: Columns3, onSelect: () => run('table.appendColumn') },
    {
      label: 'Even column widths',
      Icon: Columns3,
      disabled: !shown?.sized,
      onSelect: () => run('table.distributeColumns'),
    },
    { rule: true, label: '' },
    { label: 'Delete table', Icon: Trash2, danger: true, onSelect: () => run('table.delete') },
  ]

  // --- handles --------------------------------------------------------------

  const onHandleDown = (event: React.PointerEvent, axis: Axis, at: number) => {
    if (event.button !== 0) return
    // Never take the caret or the focus: the chrome is chrome, not an edit.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setPinned(index)
    setBand({ axis, index: at })
    setGrab({ axis, from: at, to: at, dragging: false, x: event.clientX, y: event.clientY })
  }

  const onHandleMove = (event: React.PointerEvent) => {
    if (!grab || !shown) return
    const moved = Math.abs(event.clientX - grab.x) + Math.abs(event.clientY - grab.y)
    if (!grab.dragging && moved < SLOP) return

    const at = localPoint(event)
    if (!at) return
    const bands = grab.axis === 'row' ? shown.rows : shown.columns
    let to = bandAt(bands, grab.axis === 'row' ? at.y : at.x)
    // A header row is the table's shape rather than a row of it, so nothing may
    // be dragged past it and it does not travel itself.
    if (grab.axis === 'row' && shown.headerRow) to = Math.max(1, to)
    setGrab({ ...grab, dragging: true, to })
  }

  const onHandleUp = (event: React.PointerEvent) => {
    if (!grab) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const { axis, from, to, dragging } = grab
    setGrab(null)

    if (dragging) {
      if (to !== from) {
        const target: TableTarget = axis === 'row' ? { row: from, to } : { column: from, to }
        run(axis === 'row' ? 'table.moveRow' : 'table.moveColumn', target)
      }
      setBand(null)
      setPinned(-1)
      return
    }
    // A press that went nowhere is a click: the band's menu, under the pointer.
    setMenu({ x: event.clientX, y: event.clientY, items: axis === 'row' ? rowMenu(from) : columnMenu(from) })
  }

  // --- column widths --------------------------------------------------------

  const onResizeDown = (event: React.PointerEvent, at: number) => {
    if (event.button !== 0 || !shown) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const total = shown.columns.reduce((sum, entry) => sum + entry.size, 0) || shown.width
    setPinned(index)
    setResize({
      index: at,
      x: event.clientX,
      widths: shown.columns.map((entry) => entry.size / total),
      moved: false,
    })
  }

  const onResizeMove = (event: React.PointerEvent) => {
    if (!resize || !shown) return
    const total = shown.columns.reduce((sum, entry) => sum + entry.size, 0) || shown.width
    const base = shown.columns.map((entry) => entry.size / total)
    const { index: at } = resize

    let delta = (event.clientX - resize.x) / total
    // Each drag borrows from the neighbour, so the table's own width never moves.
    delta = Math.max(MIN_SHARE - base[at], Math.min(delta, base[at + 1] - MIN_SHARE))

    const widths = [...base]
    widths[at] = base[at] + delta
    widths[at + 1] = base[at + 1] - delta
    setResize({ ...resize, widths, moved: true })
  }

  const onResizeUp = (event: React.PointerEvent) => {
    if (!resize) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    const { widths, moved } = resize
    setResize(null)
    setPinned(-1)
    // A grip that was only clicked has nothing to say — leave the widths alone.
    if (moved) run('table.setColumnWidths', { widths })
  }

  if (!shown || shown.columns.length === 0 || shown.rows.length === 0) return null

  // The handles live in the page's own margins, which the vault stylesheet owns —
  // so on a narrow pane they tuck against the table rather than off the edge.
  const leftRail = Math.max(2 - origin.left, shown.left - HANDLE - GAP)
  const topRail = shown.top - HANDLE - GAP
  const rightRail = Math.min(shown.left + shown.width + GAP, origin.width - origin.left - ADD - 2)
  const bottomRail = shown.top + shown.height + GAP

  const total = shown.columns.reduce((sum, entry) => sum + entry.size, 0) || shown.width
  const guide =
    resize &&
    shown.columns[0].start +
      resize.widths.slice(0, resize.index + 1).reduce((sum, share) => sum + share, 0) * total

  const dropAt = grab?.dragging
    ? (() => {
        const bands = grab.axis === 'row' ? shown.rows : shown.columns
        const target = bands[grab.to]
        return grab.to <= grab.from ? target.start : target.start + target.size
      })()
    : null

  return (
    <>
      <div className={styles.chrome} style={{ top: origin.top, left: origin.left }}>
        {/* The band a menu or a drag is acting on, so the target is never in doubt. */}
        {band && (
          <div
            className={styles.band}
            style={
              band.axis === 'row'
                ? {
                    top: shown.rows[band.index]?.start,
                    height: shown.rows[band.index]?.size,
                    left: shown.left,
                    width: shown.width,
                  }
                : {
                    left: shown.columns[band.index]?.start,
                    width: shown.columns[band.index]?.size,
                    top: shown.top,
                    height: shown.height,
                  }
            }
          />
        )}

        <button
          className={styles.corner}
          style={{ left: leftRail, top: topRail, width: HANDLE, height: HANDLE }}
          title="Table options"
          aria-label="Table options"
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => {
            setPinned(index)
            setMenu({ x: event.clientX, y: event.clientY, items: tableMenu() })
          }}
        >
          <Grid2x2 size={9} />
        </button>

        {shown.columns.map((entry, at) => (
          <button
            key={`c${at}`}
            className={`${styles.handle} ${band?.axis === 'column' && band.index === at ? styles.held : ''}`}
            style={{ left: entry.start + 1, top: topRail, width: Math.max(entry.size - 2, 4), height: HANDLE }}
            title="Click for column options, drag to reorder"
            aria-label={`Column ${at + 1} options`}
            onPointerDown={(event) => onHandleDown(event, 'column', at)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}

        {shown.rows.map((entry, at) => (
          <button
            key={`r${at}`}
            className={`${styles.handle} ${band?.axis === 'row' && band.index === at ? styles.held : ''}`}
            style={{ left: leftRail, top: entry.start + 1, width: HANDLE, height: Math.max(entry.size - 2, 4) }}
            title="Click for row options, drag to reorder"
            aria-label={`Row ${at + 1} options`}
            onPointerDown={(event) => onHandleDown(event, 'row', at)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}

        {/* One grip per shared edge: a drag borrows width from the next column. */}
        {shown.columns.slice(0, -1).map((entry, at) => (
          <div
            key={`g${at}`}
            className={`${styles.grip} ${resize?.index === at ? styles.gripping : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize column ${at + 1}`}
            title="Drag to resize the column"
            style={{ left: entry.start + entry.size - 3, top: shown.top, width: 6, height: shown.height }}
            onPointerDown={(event) => onResizeDown(event, at)}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeUp}
            onPointerCancel={onResizeUp}
          />
        ))}

        <button
          className={styles.add}
          style={{ left: shown.left, top: bottomRail, width: shown.width, height: ADD }}
          title="Add a row"
          aria-label="Add a row"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => run('table.appendRow')}
        >
          <Plus size={12} />
        </button>

        <button
          className={styles.add}
          style={{ left: rightRail, top: shown.top, width: ADD, height: shown.height }}
          title="Add a column"
          aria-label="Add a column"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => run('table.appendColumn')}
        >
          <Plus size={12} />
        </button>

        <button
          className={`${styles.add} ${styles.both}`}
          style={{ left: rightRail, top: bottomRail, width: ADD, height: ADD }}
          title="Add a row and a column"
          aria-label="Add a row and a column"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => run('table.appendRowAndColumn')}
        >
          <Plus size={11} />
        </button>

        {dropAt !== null && (
          <div
            className={styles.drop}
            style={
              grab?.axis === 'row'
                ? { top: dropAt - 1, left: leftRail, width: shown.left + shown.width - leftRail, height: 2 }
                : { left: dropAt - 1, top: topRail, width: 2, height: shown.top + shown.height - topRail }
            }
          />
        )}

        {guide !== null && (
          <div className={styles.guide} style={{ left: guide - 1, top: shown.top, height: shown.height }} />
        )}

      </div>
      {menu && <ContextMenu anchor={menu} onClose={closeMenu} />}
    </>
  )
}
