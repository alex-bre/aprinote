import { SELECTED } from '../dom/atoms'
import { pathOf } from '../dom/structure'
import { columnCount, columnWidths, hasHeaderColumn, hasHeaderRow, rowsOf } from './ops'

/**
 * Where a table's rows and columns are on screen, for the overlay chrome to hang
 * handles off — positioned from `getBoundingClientRect`.
 *
 * Like the block gutter's outline, geometry crosses the editor port as plain
 * numbers and a child-index path: the UI never holds an element, so a handle
 * cannot outlive the node it was measured from.
 */

/** One row or column, as an offset and a size along its axis. */
export interface Band {
  /** Offset from the editor root's border box, in CSS pixels. */
  start: number
  size: number
}

export interface TableFrame {
  /** Child indices from the editor root — the address commands travel by. */
  path: number[]
  /** Offsets from the root's border box, in CSS pixels. */
  top: number
  left: number
  width: number
  height: number
  rows: Band[]
  columns: Band[]
  headerRow: boolean
  headerColumn: boolean
  zebra: boolean
  /** True when the columns carry declared widths — a `<colgroup>`. */
  sized: boolean
  /** The table holding the caret, or selected as an atom. */
  active: boolean
}

/** What the caret (or a clicked table) is currently in. */
function activeNode(root: HTMLElement): Node | null {
  const atom = root.querySelector(`[${SELECTED}]`)
  if (atom) return atom

  const selection = root.ownerDocument.getSelection()
  const anchor = selection?.anchorNode ?? null
  return anchor && root.contains(anchor) ? anchor : null
}

/**
 * The row a table's column bands are measured from: the one with the most cells,
 * so a short row — or a header row someone has merged — cannot lose a column.
 */
function widestRow(table: HTMLTableElement): HTMLTableRowElement | null {
  const columns = columnCount(table)
  return rowsOf(table).find((row) => row.children.length === columns) ?? null
}

export function tableFrames(root: HTMLElement): TableFrame[] {
  const tables = root.querySelectorAll<HTMLTableElement>('table')
  if (tables.length === 0) return []

  const base = root.getBoundingClientRect()
  const anchor = activeNode(root)

  return [...tables].map((table) => {
    const rect = table.getBoundingClientRect()
    const rows = rowsOf(table).map((row) => {
      const box = row.getBoundingClientRect()
      return { start: box.top - base.top, size: box.height }
    })
    const columns = [...(widestRow(table)?.children ?? [])].map((cell) => {
      const box = cell.getBoundingClientRect()
      return { start: box.left - base.left, size: box.width }
    })

    return {
      path: pathOf(root, table),
      top: rect.top - base.top,
      left: rect.left - base.left,
      width: rect.width,
      height: rect.height,
      rows,
      columns,
      headerRow: hasHeaderRow(table),
      headerColumn: hasHeaderColumn(table),
      zebra: table.classList.contains('zebra'),
      sized: columnWidths(table) !== null,
      active: !!anchor && table.contains(anchor),
    }
  })
}
