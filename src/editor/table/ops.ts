import type { Command } from '../EditorSurface'
import { elementAt } from '../dom/structure'
import { closestIn, currentRange, selectRange } from '../commands/range'

/**
 * Table structure operations.
 *
 * Tables get *easier* under this design: a real `<table>` handles cell text
 * natively, so there is no cell model to maintain — only structure. These are the
 * DOM operations behind the overlay handles, the row/column menus and the `+`
 * buttons that grow the table.
 *
 * Column widths live in a `<colgroup>` of percentages, which is ordinary HTML a
 * standalone page renders exactly as the editor does — the same rule every other
 * block here follows.
 */

export interface CellPosition {
  table: HTMLTableElement
  row: HTMLTableRowElement
  cell: HTMLTableCellElement
  rowIndex: number
  columnIndex: number
}

export type ColumnAlign = 'left' | 'center' | 'right'

export function cellAt(root: HTMLElement, node: Node | null): CellPosition | null {
  const cell = closestIn(root, node, (el) => el.tagName === 'TD' || el.tagName === 'TH') as
    | HTMLTableCellElement
    | null
  if (!cell) return null

  const row = cell.parentElement as HTMLTableRowElement | null
  const table = closestIn(root, cell, (el) => el.tagName === 'TABLE') as HTMLTableElement | null
  if (!row || !table) return null

  return {
    table,
    row,
    cell,
    rowIndex: rowsOf(table).indexOf(row),
    columnIndex: [...row.children].indexOf(cell),
  }
}

export function rowsOf(table: HTMLTableElement): HTMLTableRowElement[] {
  return [...table.querySelectorAll<HTMLTableRowElement>('tr')]
}

export function columnCount(table: HTMLTableElement): number {
  return Math.max(0, ...rowsOf(table).map((row) => row.children.length))
}

export function cellOf(table: HTMLTableElement, row: number, column: number): HTMLElement | null {
  return (rowsOf(table)[row]?.children[column] as HTMLElement | undefined) ?? null
}

function blankCell(doc: Document, tag: 'td' | 'th'): HTMLTableCellElement {
  const cell = doc.createElement(tag)
  cell.appendChild(doc.createElement('br'))
  return cell as HTMLTableCellElement
}

/** Swap a cell's tag, keeping its content and attributes. */
function retag(cell: Element, tag: 'td' | 'th'): Element {
  if (cell.tagName === tag.toUpperCase()) return cell
  const replacement = cell.ownerDocument.createElement(tag)
  while (cell.firstChild) replacement.appendChild(cell.firstChild)
  for (const attr of [...cell.attributes]) replacement.setAttribute(attr.name, attr.value)
  cell.replaceWith(replacement)
  return replacement
}

/** True when the table's first row is a header row. */
export function hasHeaderRow(table: HTMLTableElement): boolean {
  const first = rowsOf(table)[0]
  return !!first && first.children.length > 0 && [...first.children].every((cell) => cell.tagName === 'TH')
}

/** The rows a header row does not own — everything a header *column* runs through. */
function bodyRows(table: HTMLTableElement): HTMLTableRowElement[] {
  const rows = rowsOf(table)
  return hasHeaderRow(table) ? rows.slice(1) : rows
}

/** True when every body row leads with a `<th>` — a header column. */
export function hasHeaderColumn(table: HTMLTableElement): boolean {
  const rows = bodyRows(table)
  return rows.length > 0 && rows.every((row) => row.firstElementChild?.tagName === 'TH')
}

// --- structure --------------------------------------------------------------

export function insertRow(table: HTMLTableElement, at: number): HTMLTableRowElement {
  const doc = table.ownerDocument
  const rows = rowsOf(table)
  const row = doc.createElement('tr')
  const header = hasHeaderColumn(table)
  for (let c = 0; c < columnCount(table); c++) {
    row.appendChild(blankCell(doc, header && c === 0 ? 'th' : 'td'))
  }

  const reference = rows[at]
  if (reference) reference.before(row)
  else (rows[rows.length - 1]?.parentElement ?? table.tBodies[0] ?? table).appendChild(row)
  return row
}

export function insertColumn(table: HTMLTableElement, at: number): void {
  const doc = table.ownerDocument
  // Read the shape before the first insertion changes it.
  const header = hasHeaderRow(table) ? rowsOf(table)[0] : null
  const headerColumn = hasHeaderColumn(table)

  for (const row of rowsOf(table)) {
    const cell = blankCell(doc, row === header ? 'th' : 'td')
    const reference = row.children[at]
    if (reference) reference.before(cell)
    else row.appendChild(cell)
  }
  // A header column stays the *first* column, so inserting before it hands the
  // header cells to the new column rather than stranding them mid-table.
  if (at === 0 && headerColumn) {
    for (const row of bodyRows(table)) {
      const [first, second] = [...row.children]
      if (first) retag(first, 'th')
      if (second) retag(second, 'td')
    }
  }

  const widths = columnWidths(table)
  if (!widths) return
  const share = 1 / (widths.length + 1)
  widths.splice(Math.max(0, Math.min(at, widths.length)), 0, share)
  setColumnWidths(table, widths)
}

export function deleteRow(table: HTMLTableElement, at: number): void {
  const rows = rowsOf(table)
  if (rows.length <= 1) return
  rows[at]?.remove()
}

export function deleteColumn(table: HTMLTableElement, at: number): void {
  if (columnCount(table) <= 1) return
  for (const row of rowsOf(table)) row.children[at]?.remove()
  if (at === 0 && hasHeaderRow(table)) {
    // The old second column is the first now; a header row stays all `<th>`.
    for (const cell of [...(rowsOf(table)[0]?.children ?? [])]) retag(cell, 'th')
  }

  const widths = columnWidths(table)
  if (!widths || at >= widths.length) return
  widths.splice(at, 1)
  setColumnWidths(table, widths)
}

/**
 * Move a row to `to`, counted in the table as it stands before the move. A header
 * row neither travels nor is displaced — it is the table's shape, not a row of it.
 */
export function moveRow(table: HTMLTableElement, from: number, to: number): void {
  if (from === to) return
  if (hasHeaderRow(table) && (from === 0 || to === 0)) return

  const rows = rowsOf(table)
  const row = rows[from]
  const target = rows[to]
  if (!row) return
  if (!target) rows[rows.length - 1]?.after(row)
  else if (to < from) target.before(row)
  else target.after(row)
}

/** Move a column to `to`, counted in the table as it stands before the move. */
export function moveColumn(table: HTMLTableElement, from: number, to: number): void {
  if (from === to) return

  for (const row of rowsOf(table)) {
    const cells = [...row.children]
    const cell = cells[from]
    if (!cell) continue
    const target = cells[to]
    if (!target) row.appendChild(cell)
    else if (to < from) target.before(cell)
    else target.after(cell)
  }
  // Header cells belong to the first column wherever the columns end up.
  if (from === 0 || to === 0) {
    const header = bodyRows(table).some((row) => row.children[from === 0 ? to : 0]?.tagName === 'TH')
    if (header) {
      for (const row of bodyRows(table)) {
        [...row.children].forEach((cell, index) => retag(cell, index === 0 ? 'th' : 'td'))
      }
    }
  }

  const widths = columnWidths(table)
  if (!widths || from >= widths.length) return
  const [width] = widths.splice(from, 1)
  widths.splice(Math.min(to, widths.length), 0, width)
  setColumnWidths(table, widths)
}

export function duplicateRow(table: HTMLTableElement, at: number): HTMLTableRowElement | null {
  const row = rowsOf(table)[at]
  if (!row) return null

  const copy = row.cloneNode(true) as HTMLTableRowElement
  // A copy of the header row is a body row — one header is the whole point of it.
  if (at === 0 && hasHeaderRow(table)) {
    const header = hasHeaderColumn(table)
    ;[...copy.children].forEach((cell, index) => retag(cell, header && index === 0 ? 'th' : 'td'))
  }
  row.after(copy)
  return copy
}

export function duplicateColumn(table: HTMLTableElement, at: number): void {
  for (const row of rowsOf(table)) {
    const cell = row.children[at]
    if (!cell) continue
    const copy = cell.cloneNode(true) as Element
    // The header column is the first one only; its copy is ordinary body text.
    if (at === 0 && cell.tagName === 'TH' && !hasHeaderRow(table)) retag(copy, 'td')
    cell.after(copy)
  }

  const widths = columnWidths(table)
  if (!widths || at >= widths.length) return
  widths.splice(at + 1, 0, widths[at])
  setColumnWidths(table, widths)
}

// --- presentation -----------------------------------------------------------

/** Promote or demote the first row between `<th>` and `<td>`. */
export function toggleHeaderRow(table: HTMLTableElement): void {
  const first = rowsOf(table)[0]
  if (!first) return

  const toHeader = !hasHeaderRow(table)
  const keepColumn = !toHeader && hasHeaderColumn(table)
  ;[...first.children].forEach((cell, index) => {
    retag(cell, toHeader || (keepColumn && index === 0) ? 'th' : 'td')
  })
}

/** Promote or demote the first cell of every body row — a row-header column. */
export function toggleHeaderColumn(table: HTMLTableElement): void {
  const rows = bodyRows(table)
  if (rows.length === 0) return

  const toHeader = !hasHeaderColumn(table)
  for (const row of rows) {
    const cell = row.firstElementChild
    if (cell) retag(cell, toHeader ? 'th' : 'td')
  }
}

/** Zebra striping is a class the vault stylesheet renders — not inline styles. */
export function toggleZebra(table: HTMLTableElement): void {
  table.classList.toggle('zebra')
  if (table.getAttribute('class') === '') table.removeAttribute('class')
}

export function columnAlign(table: HTMLTableElement, at: number): ColumnAlign {
  const cell = (rowsOf(table).at(-1)?.children[at] ?? cellOf(table, 0, at)) as HTMLElement | null
  const declared = cell?.style.textAlign
  return declared === 'center' || declared === 'right' ? declared : 'left'
}

/** Align every cell in a column. `left` clears the property rather than writing it. */
export function alignColumn(table: HTMLTableElement, at: number, align: ColumnAlign): void {
  for (const row of rowsOf(table)) {
    const cell = row.children[at] as HTMLElement | undefined
    if (!cell) continue
    if (align === 'left') cell.style.removeProperty('text-align')
    else cell.style.textAlign = align
    if (cell.getAttribute('style') === '') cell.removeAttribute('style')
  }
}

// --- column widths ----------------------------------------------------------

function shares(widths: number[]): number[] {
  const total = widths.reduce((sum, width) => sum + Math.max(0, width), 0)
  if (total <= 0) return widths.map(() => 1 / widths.length)
  return widths.map((width) => Math.max(0, width) / total)
}

/** The declared column widths as fractions of the table, or null when it has none. */
export function columnWidths(table: HTMLTableElement): number[] | null {
  const columns = [...table.querySelectorAll<HTMLElement>('colgroup > col')]
  if (columns.length === 0) return null

  const widths = columns.map((col) => parseFloat(col.style.width || col.getAttribute('width') || '0') || 0)
  return widths.some((width) => width > 0) ? shares(widths) : null
}

/**
 * Write the widths as a `<colgroup>` of percentages.
 *
 * `table-layout: fixed` goes on with them: without it a browser is free to ignore
 * a declared width whenever the content wants more room, which makes a drag look
 * like it did nothing. Both are inline, so removing them again is `distribute`.
 */
export function setColumnWidths(table: HTMLTableElement, widths: number[]): void {
  const doc = table.ownerDocument
  const group = doc.createElement('colgroup')
  for (const share of shares(widths)) {
    const col = doc.createElement('col')
    col.style.width = `${Math.round(share * 10000) / 100}%`
    group.appendChild(col)
  }

  table.querySelector('colgroup')?.remove()
  table.prepend(group)
  table.style.tableLayout = 'fixed'
  table.style.width = '100%'
}

/** Drop the declared widths and let the browser size the columns again. */
export function distributeColumns(table: HTMLTableElement): void {
  table.querySelector('colgroup')?.remove()
  table.style.removeProperty('table-layout')
  table.style.removeProperty('width')
  if (table.getAttribute('style') === '') table.removeAttribute('style')
}

// --- caret ------------------------------------------------------------------

function focusCell(root: HTMLElement, cell: Element | null | undefined): boolean {
  if (!cell) return false
  const range = root.ownerDocument.createRange()
  range.selectNodeContents(cell)
  range.collapse(true)
  selectRange(root, range)
  return true
}

/**
 * Tab moves on, and from the last cell adds a row — the behaviour the gallery
 * page advertises. Returns true when it handled the key.
 */
export function moveCell(root: HTMLElement, backwards: boolean): boolean {
  const range = currentRange(root)
  const position = range && cellAt(root, range.startContainer)
  if (!position) return false

  const { table, cell, row } = position
  const cells = [...table.querySelectorAll('th, td')]
  const at = cells.indexOf(cell)

  if (backwards) return focusCell(root, cells[at - 1])
  if (at < cells.length - 1) return focusCell(root, cells[at + 1])

  // Last cell: grow the table rather than escaping it.
  const added = insertRow(table, rowsOf(table).indexOf(row) + 1)
  return focusCell(root, added.firstElementChild)
}

/** Enter inside a table adds a row below rather than a paragraph inside a cell. */
export function rowBelow(root: HTMLElement): boolean {
  const range = currentRange(root)
  const position = range && cellAt(root, range.startContainer)
  if (!position) return false

  const added = insertRow(position.table, position.rowIndex + 1)
  return focusCell(root, added.firstElementChild)
}

// --- commands ---------------------------------------------------------------

/**
 * Where a command should act. The overlay addresses a table by path and a band by
 * index, because it lives on the far side of the editor port and holds no nodes;
 * the inspector and the keyboard pass nothing and mean "here".
 */
export interface TableTarget {
  /** Child indices from the root, addressing the table. The caret's when absent. */
  path?: number[]
  row?: number
  column?: number
  /** Destination index for a move, counted before the move happens. */
  to?: number
  align?: ColumnAlign
  /** Column widths as fractions; they are normalised to sum to one. */
  widths?: number[]
}

interface Spot {
  root: HTMLElement
  table: HTMLTableElement
  row: number
  column: number
  target: TableTarget
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max))

function resolve(root: HTMLElement, args: unknown): Spot | null {
  const target = (args ?? {}) as TableTarget
  const range = currentRange(root)
  const caret = range ? cellAt(root, range.startContainer) : null

  const named = target.path ? elementAt(root, target.path) : null
  const table = target.path
    ? named?.tagName === 'TABLE'
      ? (named as HTMLTableElement)
      : null
    : (caret?.table ?? null)
  if (!table) return null

  const here = caret?.table === table ? caret : null
  return {
    root,
    table,
    row: clamp(target.row ?? here?.rowIndex ?? 0, rowsOf(table).length - 1),
    column: clamp(target.column ?? here?.columnIndex ?? 0, columnCount(table) - 1),
    target,
  }
}

/** Each command acts on the table it is given, or on the one holding the caret. */
function tableCommand(act: (spot: Spot) => void): Command {
  return (root, args) => {
    const spot = resolve(root, args)
    if (spot) act(spot)
  }
}

/** Leave the caret in the table after a structural edit, clamped to what remains. */
function land(spot: Spot, row: number, column: number): void {
  const cell = cellOf(
    spot.table,
    clamp(row, rowsOf(spot.table).length - 1),
    clamp(column, columnCount(spot.table) - 1),
  )
  focusCell(spot.root, cell)
}

export const tableCommands: Record<string, Command> = {
  'table.insertRowAbove': tableCommand((s) => {
    // Nothing goes above a header row: a `<td>` row there reads as a second,
    // broken header. Asking for one means the row just under it.
    const at = hasHeaderRow(s.table) ? Math.max(1, s.row) : s.row
    insertRow(s.table, at)
    land(s, at, s.column)
  }),
  'table.insertRowBelow': tableCommand((s) => {
    insertRow(s.table, s.row + 1)
    land(s, s.row + 1, s.column)
  }),
  /** What the `+` beneath the table runs — a row on the end, ready to type in. */
  'table.appendRow': tableCommand((s) => {
    const rows = rowsOf(s.table).length
    insertRow(s.table, rows)
    land(s, rows, 0)
  }),
  'table.duplicateRow': tableCommand((s) => {
    duplicateRow(s.table, s.row)
    land(s, s.row + 1, s.column)
  }),
  'table.moveRow': tableCommand((s) => moveRow(s.table, s.row, s.target.to ?? s.row)),
  'table.deleteRow': tableCommand((s) => {
    deleteRow(s.table, s.row)
    land(s, s.row, s.column)
  }),

  'table.insertColumnBefore': tableCommand((s) => {
    insertColumn(s.table, s.column)
    land(s, s.row, s.column)
  }),
  'table.insertColumnAfter': tableCommand((s) => {
    insertColumn(s.table, s.column + 1)
    land(s, s.row, s.column + 1)
  }),
  /** What the `+` beside the table runs. */
  'table.appendColumn': tableCommand((s) => {
    const columns = columnCount(s.table)
    insertColumn(s.table, columns)
    land(s, 0, columns)
  }),
  /** The corner `+`: one gesture, so one undo takes both back. */
  'table.appendRowAndColumn': tableCommand((s) => {
    const rows = rowsOf(s.table).length
    const columns = columnCount(s.table)
    insertRow(s.table, rows)
    insertColumn(s.table, columns)
    land(s, rows, columns)
  }),
  'table.duplicateColumn': tableCommand((s) => {
    duplicateColumn(s.table, s.column)
    land(s, s.row, s.column + 1)
  }),
  'table.moveColumn': tableCommand((s) => moveColumn(s.table, s.column, s.target.to ?? s.column)),
  'table.deleteColumn': tableCommand((s) => {
    deleteColumn(s.table, s.column)
    land(s, s.row, s.column)
  }),

  'table.alignColumn': tableCommand((s) => alignColumn(s.table, s.column, s.target.align ?? 'left')),
  'table.setColumnWidths': tableCommand((s) => {
    if (s.target.widths?.length) setColumnWidths(s.table, s.target.widths)
  }),
  'table.distributeColumns': tableCommand((s) => distributeColumns(s.table)),
  'table.toggleHeaderRow': tableCommand((s) => toggleHeaderRow(s.table)),
  'table.toggleHeaderColumn': tableCommand((s) => toggleHeaderColumn(s.table)),
  'table.toggleZebra': tableCommand((s) => toggleZebra(s.table)),
  'table.delete': tableCommand((s) => {
    // Somewhere for the caret to go, or it is left pointing at nothing at all.
    const after = s.table.nextElementSibling ?? s.table.previousElementSibling
    s.table.remove()
    if (after) focusCell(s.root, after)
  }),
}
