import { SELECTED } from './atoms'
import { blockLabel, isColumn, isColumns, isContainer } from './structure'

/**
 * The document's rows, as the gutter sees them: one entry per block, in document
 * order, each with the geometry needed to draw a label beside it and the address
 * `moveBlock` needs to move it.
 *
 * Geometry crosses the port as plain numbers rather than elements — the port keeps the
 * UI out of the editor's DOM, and numbers are all a gutter has ever needed.
 */
export interface BlockRow {
  /** Child indices from the editor root — the address, since a node cannot travel. */
  path: number[]
  /** `p`, `h1`, `callout`, `img` — what this block is, in a word. */
  label: string
  /** 0 for a block in the article, 1 inside a callout, and so on. */
  depth: number
  /** Offsets from the root's border box, in CSS pixels. */
  top: number
  left: number
  width: number
  height: number
  /** The row holding the caret or the selected atom — the "current line". */
  active: boolean
  /** True for a callout — a block that can hold other blocks. */
  container: boolean
  /**
   * Inside a column layout, where blocks stand side by side and there is no
   * margin to name them in: the row gets a handle but no label.
   */
  quiet: boolean
}

/** Deep enough for a callout inside a callout; past that the gutter is noise. */
const MAX_DEPTH = 2

/** What the caret (or a clicked image) is currently in. */
function activeNode(root: HTMLElement): Node | null {
  const atom = root.querySelector(`[${SELECTED}]`)
  if (atom) return atom

  const selection = root.ownerDocument.getSelection()
  const anchor = selection?.anchorNode ?? null
  return anchor && root.contains(anchor) ? anchor : null
}

export function outline(root: HTMLElement): BlockRow[] {
  const rows: BlockRow[] = []
  const base = root.getBoundingClientRect()
  const anchor = activeNode(root)
  let active = -1

  const walk = (host: HTMLElement, path: number[], depth: number, quiet: boolean) => {
    host.childNodes.forEach((child, index) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return
      const element = child as HTMLElement
      const at = [...path, index]
      const rect = element.getBoundingClientRect()
      const inLayout = quiet || isColumns(host)

      rows.push({
        path: at,
        label: blockLabel(element),
        depth,
        top: rect.top - base.top,
        left: rect.left - base.left,
        width: rect.width,
        height: rect.height,
        active: false,
        container: isContainer(element),
        quiet: inLayout,
      })
      // Children come after their container, so the innermost match wins — among
      // the rows with a label to light up.
      if (anchor && element.contains(anchor) && !inLayout) active = rows.length - 1

      // A layout and its columns are scaffolding, not nesting a reader sees, so
      // they do not spend the depth a callout in a column still needs.
      const scaffold = isColumns(element) || isColumn(element)
      if (isContainer(element) && (scaffold || depth < MAX_DEPTH)) {
        walk(element, at, scaffold ? depth : depth + 1, inLayout)
      }
    })
  }

  walk(root, [], 0, false)
  if (active >= 0) rows[active].active = true
  return rows
}
