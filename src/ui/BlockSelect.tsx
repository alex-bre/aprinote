import { useCallback, useEffect, useRef, useState } from 'react'
import type { BlockRow } from '@/editor/EditorSurface'
import { useEditor } from '@/store/editorStore'
import styles from './BlockSelect.module.css'

/**
 * The marquee: draw a box in the page's margins and every block it crosses is
 * picked, so several can be dragged somewhere else from any of their gutter
 * handles, or thrown away together with Backspace.
 *
 * Like the gutter beside it this reads geometry through the editor port and holds
 * no nodes of its own; the picked set lives in the document as a marker attribute,
 * which is why a group survives the move it was just dragged through.
 *
 * The gesture starts only where a drag would otherwise mean nothing — beside the
 * text, between two blocks, above the first or below the last. Inside a block a
 * drag still selects text, because that is what a drag inside text has always
 * meant and no marquee is worth taking it away.
 */

/** Movement, in pixels, before a press on empty space becomes a marquee. */
const SLOP = 4
/** How close to the pane's edge a drag has to get before the pane scrolls. */
const EDGE = 48
const SPEED = 12

/** Offsets from the host's border box, in CSS pixels — the gutter's units. */
interface Box {
  top: number
  left: number
  width: number
  height: number
  /** Where the host sits in the pane, so the layer can be pinned to it. */
  originTop: number
  originLeft: number
}

/** True when `path` is `prefix` or sits inside it. */
function within(path: number[], prefix: number[]): boolean {
  return prefix.every((value, i) => path[i] === value)
}

/**
 * The blocks a marquee crosses.
 *
 * Blocks stack, so it is the vertical span that decides: a box drawn in the
 * margin beside a paragraph means that paragraph, however far from the text it
 * was drawn. A picked callout takes its children with it, so they are left out —
 * in the set as well they would be moved twice and deleted twice.
 */
function rowsIn(rows: BlockRow[], top: number, bottom: number, base: number[][]): number[][] {
  const paths = [...base]
  for (const row of rows) {
    if (row.top >= bottom || row.top + row.height <= top) continue
    if (paths.some((path) => within(row.path, path))) continue
    paths.push(row.path)
  }
  return paths
}

/**
 * Put the caret at a viewport point. A press in the margin is prevented from
 * doing anything by default — that is what stops it dragging out a text
 * selection — so the click it turns out to be has to be honoured by hand.
 */
function caretAt(root: HTMLElement, clientX: number, clientY: number): void {
  const doc = root.ownerDocument
  const range = doc.caretRangeFromPoint?.(clientX, clientY)
  root.focus({ preventScroll: true })
  if (!range || !root.contains(range.startContainer)) return
  const selection = doc.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function BlockSelect({
  host,
  bounds,
}: {
  /** The editor host element — the marquee is measured from its box. */
  host: React.RefObject<HTMLElement | null>
  /** The scrolling pane both live in. */
  bounds: React.RefObject<HTMLElement | null>
}) {
  const surface = useEditor((s) => s.surface)
  const [box, setBox] = useState<Box | null>(null)
  /** Live only once the press has travelled far enough to mean a box. */
  const [scrolling, setScrolling] = useState(false)

  const drag = useRef<{
    anchor: { x: number; y: number }
    /** Measured once: nothing reflows mid-drag, and a scroll does not move these. */
    rows: BlockRow[]
    /** What was already picked, when the box is being added to. */
    base: number[][]
    live: boolean
  } | null>(null)
  const pointer = useRef({ clientX: 0, clientY: 0 })

  /** Document coordinates for a pointer event: offsets from the host's box. */
  const localPoint = useCallback(
    (event: { clientX: number; clientY: number }) => {
      const rect = host.current?.getBoundingClientRect()
      if (!rect) return null
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    [host],
  )

  const draw = useCallback(() => {
    const state = drag.current
    const article = host.current
    const at = localPoint(pointer.current)
    if (!state || !article || !at || !surface) return

    const top = Math.min(state.anchor.y, at.y)
    const bottom = Math.max(state.anchor.y, at.y)
    setBox({
      top,
      left: Math.min(state.anchor.x, at.x),
      width: Math.abs(at.x - state.anchor.x),
      height: bottom - top,
      originTop: article.offsetTop,
      originLeft: article.offsetLeft,
    })
    surface.setPicked(rowsIn(state.rows, top, bottom, state.base))
  }, [host, localPoint, surface])

  useEffect(() => {
    const pane = bounds.current
    const article = host.current
    if (!pane || !article || !surface) return

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || drag.current) return
      // A finger dragging the page is scrolling it, and no selection gesture is
      // worth taking that away; the gutter's handles are the touch story.
      if (event.pointerType === 'touch') return
      const target = event.target as Node | null
      // Chrome owns its own gestures: a gutter handle, a table's controls and the
      // floating bar all sit beside the page rather than in it.
      if (target !== pane && !(target && article.contains(target))) return

      // A double or triple click is the browser's word and paragraph selection,
      // which still works from the margin — leave the second click to it.
      if (event.detail > 1) return surface.setPicked([])

      const at = localPoint(event)
      if (!at) return
      const rows = surface.blocks()
      const inside = rows.some(
        (row) =>
          at.y >= row.top &&
          at.y < row.top + row.height &&
          at.x >= row.left &&
          at.x < row.left + row.width,
      )
      // A drag that starts in text is a text selection, and it ends the marquee's.
      if (inside) return surface.setPicked([])

      // Never take the caret or the focus — the same reason the gutter's handle
      // does this. `onPointerUp` puts the caret back when it was only a click.
      event.preventDefault()
      pane.setPointerCapture(event.pointerId)
      pointer.current = { clientX: event.clientX, clientY: event.clientY }
      drag.current = {
        anchor: at,
        rows,
        base: event.shiftKey ? surface.picked() : [],
        live: false,
      }
      if (!event.shiftKey) surface.setPicked([])
    }

    const onPointerMove = (event: PointerEvent) => {
      const state = drag.current
      if (!state) return
      pointer.current = { clientX: event.clientX, clientY: event.clientY }

      if (!state.live) {
        const at = localPoint(event)
        if (!at) return
        if (Math.abs(at.x - state.anchor.x) < SLOP && Math.abs(at.y - state.anchor.y) < SLOP) return
        state.live = true
        setScrolling(true)
      }
      draw()
    }

    const onPointerUp = (event: PointerEvent) => {
      const state = drag.current
      if (!state) return
      drag.current = null
      setBox(null)
      setScrolling(false)
      if (pane.hasPointerCapture(event.pointerId)) pane.releasePointerCapture(event.pointerId)

      if (state.live) {
        // Backspace and Escape belong to the document, so it has to be the one
        // hearing them — but only take the focus when nothing in there has it.
        if (!article.contains(article.ownerDocument.activeElement)) surface.focus()
        return
      }
      surface.setPicked([])
      caretAt(article, event.clientX, event.clientY)
    }

    pane.addEventListener('pointerdown', onPointerDown)
    pane.addEventListener('pointermove', onPointerMove)
    pane.addEventListener('pointerup', onPointerUp)
    pane.addEventListener('pointercancel', onPointerUp)

    return () => {
      pane.removeEventListener('pointerdown', onPointerDown)
      pane.removeEventListener('pointermove', onPointerMove)
      pane.removeEventListener('pointerup', onPointerUp)
      pane.removeEventListener('pointercancel', onPointerUp)
    }
  }, [bounds, host, surface, localPoint, draw])

  // Auto-scroll while the box is dragged against the top or bottom of the pane,
  // so a selection can reach further than one screenful — the rows were measured
  // from the host, which the scroll does not move.
  useEffect(() => {
    if (!scrolling) return
    let raf = 0
    const step = () => {
      const pane = bounds.current
      if (pane && drag.current) {
        const rect = pane.getBoundingClientRect()
        const above = pointer.current.clientY - (rect.top + EDGE)
        const below = pointer.current.clientY - (rect.bottom - EDGE)
        const by = above < 0 ? Math.max(above, -SPEED) : below > 0 ? Math.min(below, SPEED) : 0
        if (by) {
          pane.scrollTop += by
          draw()
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [scrolling, bounds, draw])

  if (!box) return null

  return (
    <div className={styles.layer} style={{ top: box.originTop, left: box.originLeft }}>
      <div
        className={styles.box}
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      />
    </div>
  )
}
