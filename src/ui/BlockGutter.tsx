import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import type { BlockRow } from '@/editor/EditorSurface'
import { useEditor } from '@/store/editorStore'
import styles from './BlockGutter.module.css'

/**
 * The block gutter: one line-number-ish label per block saying what it is, and a
 * handle for dragging it somewhere else.
 *
 * It reads geometry through the editor port and writes through a command —
 * it never touches the document's DOM, which is what keeps the port honest and
 * what makes a drop undoable like any other edit.
 *
 * A handle on a block the marquee has picked drags the whole selection, so the
 * one gesture serves both: nothing new to learn once several blocks are lit.
 */

/** Below this the label has nowhere to sit — a phone, or a very narrow pane. */
const MIN_WIDTH = 24
/** Gap between a label and the text it names. */
const INSET = 8
/**
 * How far left of a block inside a column layout the pointer still counts as on
 * it — about the gap between two columns, and short of the layout's own handle,
 * which sits further out beside its label.
 */
const REACH = 28
/** How close to the pane's edge a drag has to get before the pane scrolls. */
const EDGE = 48
const SPEED = 12

/** Where a dragged block would land. */
interface Gap {
  to: number[]
  position: 'before' | 'after' | 'inside'
  /** Offsets from the root's border box, for drawing the line. */
  y: number
  left: number
  width: number
  /** A gap inside a column layout, which only counts with the pointer over its column. */
  quiet: boolean
}

function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

function samePaths(a: number[][], b: number[][]): boolean {
  return a.length === b.length && a.every((path, i) => samePath(path, b[i]))
}

/** True when `paths` names exactly this block. */
const hasPath = (paths: number[][], path: number[]) => paths.some((one) => samePath(one, path))

/** True when `path` is `prefix` or sits inside it. */
function within(path: number[], prefix: number[]): boolean {
  return prefix.every((value, i) => path[i] === value)
}

function sameRows(a: BlockRow[], b: BlockRow[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => {
      const other = b[i]
      return (
        row.label === other.label &&
        row.top === other.top &&
        row.left === other.left &&
        row.height === other.height &&
        row.width === other.width &&
        row.active === other.active &&
        row.quiet === other.quiet &&
        samePath(row.path, other.path)
      )
    })
  )
}

/**
 * Every position the dragged blocks could be dropped into: above and below each
 * row. Two entries can name the same place (below one block is above the next);
 * harmless, since the nearest one wins and both do the same thing.
 */
function gapsFor(rows: BlockRow[], sources: number[][]): Gap[] {
  const gaps: Gap[] = []
  rows.forEach((row, index) => {
    // Dropping a block inside itself would take it out of the document with it.
    if (sources.some((path) => within(row.path, path))) return
    const shape = { left: row.left, width: row.width, quiet: row.quiet }
    gaps.push({ to: row.path, position: 'before', y: row.top, ...shape })
    gaps.push({ to: row.path, position: 'after', y: row.top + row.height, ...shape })

    // An empty callout, or one holding a single run of text, has no rows of its
    // own to aim between — so the callout itself is the target.
    const holds = rows[index + 1] && within(rows[index + 1].path, row.path)
    if (row.container && !holds) {
      gaps.push({
        to: row.path,
        position: 'inside',
        y: row.top + row.height / 2,
        left: row.left + 16,
        width: Math.max(row.width - 32, 40),
        quiet: row.quiet,
      })
    }
  })
  return gaps
}

/**
 * The gap nearest the pointer. Where two are level — the end of a callout and the
 * space just below the callout itself — the pointer's own indent decides, which
 * is the only way to say "inside" or "outside" with one gesture.
 */
function nearestGap(gaps: Gap[], x: number, y: number): Gap | null {
  let best: Gap | null = null
  let bestDy = Infinity
  for (const gap of gaps) {
    if (gap.quiet && (x < gap.left - REACH || x > gap.left + gap.width)) continue
    const dy = Math.abs(gap.y - y)
    if (dy < bestDy - 6) {
      best = gap
      bestDy = dy
    } else if (best && Math.abs(dy - bestDy) <= 6 && Math.abs(gap.left - x) < Math.abs(best.left - x)) {
      best = gap
      bestDy = Math.min(dy, bestDy)
    }
  }
  return best
}

export function BlockGutter({
  host,
  bounds,
  hidePath,
}: {
  /** The editor host element — the gutter aligns to its box, never inside it. */
  host: React.RefObject<HTMLElement | null>
  /** The scrolling pane both live in. */
  bounds: React.RefObject<HTMLElement | null>
  /**
   * One block to leave unlabelled: a table wearing its own chrome needs the same
   * margin this gutter draws in, and two handles in one strip is a coin toss.
   */
  hidePath?: number[] | null
}) {
  const surface = useEditor((s) => s.surface)
  const [rows, setRows] = useState<BlockRow[]>([])
  const [origin, setOrigin] = useState({ top: 0, left: 0 })
  const [hover, setHover] = useState(-1)
  /** The blocks a marquee has picked, which a handle then drags as one. */
  const [picked, setPicked] = useState<number[][]>([])
  const [drag, setDrag] = useState<{ paths: number[][]; gap: Gap | null } | null>(null)

  const frame = useRef(0)
  const dragging = useRef(false)
  const pointer = useRef({ clientX: 0, clientY: 0 })
  const state = useRef({ rows, origin, drag, picked })
  state.current = { rows, origin, drag, picked }

  const measure = useCallback(() => {
    const article = host.current
    if (!surface || !article) return
    const next = surface.blocks()
    setRows((previous) => (sameRows(previous, next) ? previous : next))
    const marked = surface.picked()
    setPicked((previous) => (samePaths(previous, marked) ? previous : marked))
    setOrigin((previous) => {
      const { offsetTop: top, offsetLeft: left } = article
      return previous.top === top && previous.left === left ? previous : { top, left }
    })
  }, [surface, host])

  /** Coalesce the measurement — a keystroke and a selection change are one frame. */
  const sync = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    if (!surface) {
      setRows([])
      setPicked([])
      return
    }
    sync()
    const offChange = surface.on('change', sync)
    const offSelection = surface.on('selection', sync)

    // Images arriving and the window resizing both move rows without an edit.
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

  /** Document coordinates for a pointer event: offsets from the host's box. */
  const localPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = host.current?.getBoundingClientRect()
      if (!rect) return null
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    [host],
  )

  /**
   * The innermost row under the pointer — children come after their container.
   * Height alone decides for ordinary rows, whose handles live out in the margin;
   * columns stand side by side at the same height, so there the pointer has to be
   * over the column too, or just left of it.
   */
  const rowAt = useCallback((x: number, y: number) => {
    let found = -1
    state.current.rows.forEach((row, index) => {
      if (y < row.top || y >= row.top + row.height) return
      if (row.quiet && (x < row.left - REACH || x > row.left + row.width)) return
      found = index
    })
    return found
  }, [])

  // Hovering the block itself reveals its handle, not just the strip beside it.
  useEffect(() => {
    const pane = bounds.current
    if (!pane) return
    const onMove = (event: PointerEvent) => {
      if (dragging.current) return
      const at = localPoint(event)
      setHover(at ? rowAt(at.x, at.y) : -1)
    }
    const onLeave = () => !dragging.current && setHover(-1)
    pane.addEventListener('pointermove', onMove)
    pane.addEventListener('pointerleave', onLeave)
    return () => {
      pane.removeEventListener('pointermove', onMove)
      pane.removeEventListener('pointerleave', onLeave)
    }
  }, [bounds, localPoint, rowAt])

  const aim = useCallback(
    (paths: number[][], event: { clientX: number; clientY: number }) => {
      const at = localPoint(event)
      if (!at || paths.length === 0) return null
      return nearestGap(gapsFor(state.current.rows, paths), at.x, at.y)
    },
    [localPoint],
  )

  /**
   * What this handle drags: the whole selection when the block it belongs to is
   * part of one, and otherwise just that block.
   */
  const dragSet = useCallback((index: number): number[][] => {
    const row = state.current.rows[index]
    if (!row) return []
    const { picked: marked } = state.current
    return hasPath(marked, row.path) ? marked : [row.path]
  }, [])

  // Auto-scroll while a drag hangs near the top or bottom of the pane, so a block
  // can be dragged further than one screenful.
  useEffect(() => {
    if (!drag) return
    let raf = 0
    const step = () => {
      const pane = bounds.current
      if (pane) {
        const rect = pane.getBoundingClientRect()
        const above = pointer.current.clientY - (rect.top + EDGE)
        const below = pointer.current.clientY - (rect.bottom - EDGE)
        const by = above < 0 ? Math.max(above, -SPEED) : below > 0 ? Math.min(below, SPEED) : 0
        if (by) {
          pane.scrollTop += by
          const paths = state.current.drag?.paths
          if (paths) setDrag({ paths, gap: aim(paths, pointer.current) })
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [drag, bounds, aim])

  const onGripDown = (event: React.PointerEvent, index: number) => {
    if (event.button !== 0) return
    // Never take the caret or the focus: the drag is chrome, not an edit.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = true
    pointer.current = { clientX: event.clientX, clientY: event.clientY }
    setHover(index)
    const paths = dragSet(index)
    setDrag({ paths, gap: aim(paths, event) })
  }

  const onGripMove = (event: React.PointerEvent) => {
    if (!dragging.current || !drag) return
    pointer.current = { clientX: event.clientX, clientY: event.clientY }
    setDrag({ paths: drag.paths, gap: aim(drag.paths, event) })
  }

  const onGripUp = (event: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)

    const from = drag?.paths ?? []
    const gap = drag?.gap
    setDrag(null)
    // Dropping blocks against one of their own is where they already are.
    const idle = gap && gap.position !== 'inside' && hasPath(from, gap.to)
    if (from.length && gap && !idle) {
      surface?.exec('moveBlocks', { from, to: gap.to, position: gap.position })
    }
  }

  // The label sits between the pane's edge and the text, so how much room there is
  // depends on the vault stylesheet's own padding and on the window.
  const width = (rows[0]?.left ?? 0) + origin.left - INSET
  if (rows.length === 0 || width < MIN_WIDTH) return null

  return (
    <div className={styles.gutter} style={{ top: origin.top, left: 0 }}>
      {rows.map((row, index) =>
        hidePath && samePath(row.path, hidePath) ? null : (
        <div
          key={row.path.join('.')}
          className={[
            styles.row,
            row.active ? styles.active : '',
            hasPath(picked, row.path) ? styles.picked : '',
            index === hover ? styles.hovered : '',
            drag && hasPath(drag.paths, row.path) ? styles.dragging : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            top: row.top,
            width: Math.max(0, row.left + origin.left - INSET),
            height: Math.min(row.height, 28),
          }}
        >
          <button
            className={styles.grip}
            title={
              hasPath(picked, row.path) && picked.length > 1
                ? `Drag to move the ${picked.length} selected blocks`
                : `Drag to move this ${row.label}`
            }
            aria-label={`Move ${row.label}`}
            onPointerDown={(event) => onGripDown(event, index)}
            onPointerMove={onGripMove}
            onPointerUp={onGripUp}
            onPointerCancel={onGripUp}
          >
            <GripVertical size={12} />
          </button>
          {!row.quiet && <span className={styles.label}>{row.label}</span>}
        </div>
        ),
      )}

      {drag?.gap && (
        <div
          className={styles.drop}
          style={{
            top: drag.gap.y - 1,
            left: drag.gap.left + origin.left,
            width: Math.max(drag.gap.width, 40),
          }}
        />
      )}
    </div>
  )
}
