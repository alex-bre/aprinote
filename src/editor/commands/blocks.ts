import type { Command } from '../EditorSurface'
import { pickedPaths } from '../dom/picked'
import {
  ATOM_TAGS,
  anchorBlock,
  elementAt,
  emptyParagraph,
  inBlockForm,
  isColumn,
  isColumns,
  isContainer,
  isTextBlock,
  wrapInlineContent,
} from '../dom/structure'
import { blockOf, closestIn, currentRange, selectRange } from './range'

/**
 * Rich blocks. Every one of these is hand-written — `execCommand` has no
 * equivalent, and the markup they emit is the point: a callout is a plain
 * `<div class="callout">`, a code block a plain `<pre><code>`, because pages are
 * ordinary HTML documents and anything valid can live in them.
 */

function caretInto(root: HTMLElement, node: Node, offset = 0): void {
  const range = root.ownerDocument.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  selectRange(root, range)
}

/**
 * Replace the block at the caret, or append when there is nowhere obvious.
 *
 * The anchor is the block whose parent is the article *or a callout*, so a table
 * or an image inserted while the caret is in a callout lands inside it rather
 * than jumping out to the end of the document.
 */
export function placeBlock(root: HTMLElement, element: HTMLElement): void {
  const range = currentRange(root)
  const target = range ? anchorBlock(root, range.startContainer) : null

  if (isTextBlock(target) && !target.textContent?.trim()) {
    target.replaceWith(element)
  } else if (target) {
    target.after(element)
  } else {
    root.appendChild(element)
  }

  // The normaliser guarantees a paragraph after a trailing atom, so the caret
  // always has somewhere to land.
  const after = element.nextElementSibling
  if (after) caretInto(root, after, 0)
}

const el = (root: HTMLElement, tag: string, attrs: Record<string, string> = {}) => {
  const node = root.ownerDocument.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value)
  return node
}

export const insertDivider: Command = (root) => {
  placeBlock(root, el(root, 'hr'))
}

export const insertCallout: Command = (root) => {
  const range = currentRange(root)
  const block = range ? anchorBlock(root, range.startContainer) : null

  // Turn the current paragraph into a callout when it has text, so the gesture
  // reads as "make this a callout" rather than "add an empty one below".
  if (block?.tagName === 'P' && block.textContent?.trim()) {
    const callout = el(root, 'div', { class: 'callout' })
    while (block.firstChild) callout.appendChild(block.firstChild)
    block.replaceWith(callout)
    caretInto(root, callout, callout.childNodes.length)
    return
  }

  const callout = el(root, 'div', { class: 'callout' })
  callout.appendChild(root.ownerDocument.createElement('br'))
  placeBlock(root, callout)
  caretInto(root, callout, 0)
}

/** Enough to lay things side by side; past four, a column has no measure left. */
export const MAX_COLUMNS = 4

function columnCount(args: unknown): number {
  const count = typeof args === 'number' ? args : (args as { count?: number } | undefined)?.count
  return Math.max(1, Math.min(MAX_COLUMNS, Math.round(count ?? 2)))
}

function newColumn(root: HTMLElement): HTMLElement {
  const column = el(root, 'div', { class: 'column' })
  column.appendChild(emptyParagraph(root.ownerDocument))
  return column
}

/** The outermost column layout around `node` — where a new layout goes after. */
function outerColumns(root: HTMLElement, node: Node): HTMLElement | null {
  let found: HTMLElement | null = null
  for (let current: Node | null = node; current && current !== root; current = current.parentNode) {
    if (isColumns(current)) found = current
  }
  return found
}

/**
 * Side-by-side columns: `<div class="columns">` holding a `<div class="column">`
 * per column, each a container of blocks like a callout.
 *
 * A line of text the caret is on becomes the first column's content, the same
 * "make this…" reading a callout has. Layouts never nest — inside one, a new
 * layout goes after it, because columns in a column have nowhere to fit.
 */
export const insertColumns: Command = (root, args) => {
  const count = Math.max(2, columnCount(args))
  const layout = el(root, 'div', { class: 'columns' })
  for (let i = 0; i < count; i++) layout.appendChild(newColumn(root))
  const first = layout.firstElementChild as HTMLElement

  const range = currentRange(root)
  const outer = range ? outerColumns(root, range.startContainer) : null
  const block = range && !outer ? anchorBlock(root, range.startContainer) : null

  if (outer) {
    outer.after(layout)
  } else if (block?.tagName === 'P' && block.textContent?.trim()) {
    block.replaceWith(layout)
    first.replaceChildren(block)
  } else {
    placeBlock(root, layout)
  }

  const target = first.firstElementChild ?? first
  caretInto(root, target, target.textContent ? target.childNodes.length : 0)
}

/**
 * Give the layout at the caret `count` columns. New ones arrive empty at the end;
 * columns taken away hand their blocks to the last one kept, so shrinking a
 * layout never deletes anything. One column dissolves the layout altogether,
 * leaving its blocks in the page in reading order.
 */
export const setColumns: Command = (root, args) => {
  const range = currentRange(root)
  if (!range) return
  const layout = closestIn(root, range.startContainer, isColumns)
  if (!layout) return

  const count = columnCount(args)
  const doc = root.ownerDocument
  const columns = [...layout.children].filter(isColumn)
  const caret = { node: range.startContainer, offset: range.startOffset }

  /** A column's blocks, less the empty paragraph a fresh column is born with. */
  const contents = (column: HTMLElement): Node[] => {
    if (!inBlockForm(column)) {
      if (!column.textContent?.trim() && !column.querySelector('img, iframe')) return []
      wrapInlineContent(column)
    }
    return [...column.childNodes].filter(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        !(isTextBlock(node as Element) && !node.textContent?.trim() && !(node as Element).querySelector('img')),
    )
  }

  if (count === 1) {
    const fragment = doc.createDocumentFragment()
    for (const column of columns) fragment.append(...contents(column))
    if (fragment.childNodes.length === 0) fragment.appendChild(emptyParagraph(doc))
    const landing = fragment.firstChild as HTMLElement
    layout.replaceWith(fragment)
    if (root.contains(caret.node)) caretInto(root, caret.node, caret.offset)
    else caretInto(root, landing, 0)
    return
  }

  for (let i = columns.length; i < count; i++) layout.appendChild(newColumn(root))

  if (columns.length > count) {
    const keep = columns[count - 1]
    const moved = columns.slice(count).flatMap(contents)
    if (moved.length) {
      // The keeper's own empty paragraph would sit between its text and what arrives.
      const own = contents(keep)
      if (own.length === 0) keep.replaceChildren()
      keep.append(...moved)
    }
    for (const column of columns.slice(count)) column.remove()
  }

  // Moving a node walks every live range boundary inside it out to the old parent,
  // so the caret goes back by hand to the node it was really in.
  if (root.contains(caret.node)) caretInto(root, caret.node, caret.offset)
  else {
    const last = [...layout.children].filter(isColumn)[count - 1]
    const block = last?.lastElementChild ?? last
    if (block) caretInto(root, block, block.childNodes.length)
  }
}

export const insertCodeBlock: Command = (root) => {
  const range = currentRange(root)
  const block = range ? anchorBlock(root, range.startContainer) : null
  // A line of prose becomes the code block's first line; a table or an image is a
  // block in its own right, so the code block goes after it instead.
  const source = isTextBlock(block) ? block : null

  const pre = el(root, 'pre')
  const code = el(root, 'code')
  const text = source?.textContent?.trim() || ''
  if (text) code.textContent = text
  else code.appendChild(root.ownerDocument.createElement('br'))
  pre.appendChild(code)

  if (source) source.replaceWith(pre)
  else placeBlock(root, pre)
  caretInto(root, code, code.childNodes.length)
}

/** A 3×2 table with a header row, matching the gallery's shape. */
export const insertTable: Command = (root, args) => {
  const { rows = 3, columns = 2 } = (args as { rows?: number; columns?: number }) ?? {}
  const table = el(root, 'table')

  for (let r = 0; r < rows; r++) {
    const tr = el(root, 'tr')
    for (let c = 0; c < columns; c++) {
      const cell = el(root, r === 0 ? 'th' : 'td')
      cell.appendChild(root.ownerDocument.createElement('br'))
      tr.appendChild(cell)
    }
    table.appendChild(tr)
  }

  placeBlock(root, table)
  const first = table.querySelector('th, td')
  if (first) caretInto(root, first, 0)
}

/**
 * An embed is inert while editing — a card, not a live frame — so a page full of
 * third-party iframes stays editable and cannot steal the caret. Preview renders
 * the real thing in its sandbox.
 */
export const insertEmbed: Command = (root, args) => {
  const url = typeof args === 'string' ? args.trim() : ''
  if (!url) return

  // Inserted already inert: the src lives in `data-aprinote-src` so the frame is
  // never fetched while editing (see `assets/resolve.ts`).
  const figure = el(root, 'figure', { class: 'embed', 'data-aprinote-embed': url })
  const frame = el(root, 'iframe', {
    'data-aprinote-src': url,
    loading: 'lazy',
    referrerpolicy: 'no-referrer',
    allowfullscreen: '',
  })
  figure.appendChild(frame)
  placeBlock(root, figure)
}

/** `<figure>` + `<img>` + caption, the shape the inspector's constraints act on. */
export function buildFigure(root: HTMLElement, src: string, alt = ''): HTMLElement {
  const figure = el(root, 'figure')
  const image = el(root, 'img', { src, alt, loading: 'lazy' })
  const caption = el(root, 'figcaption')
  caption.appendChild(root.ownerDocument.createElement('br'))
  figure.append(image, caption)
  return figure
}

export const insertFigure: Command = (root, args) => {
  const { src, alt } = (args as { src: string; alt?: string }) ?? {}
  if (!src) return
  placeBlock(root, buildFigure(root, src, alt))
}

/** Set or clear a style property on the block the caret sits in. */
export const styleBlock: Command = (root, args) => {
  const { selector, property, value } = (args as {
    selector?: string
    property: string
    value: string | null
  }) ?? { property: '', value: null }
  if (!property) return

  const range = currentRange(root)
  if (!range) return

  const target = selector
    ? closestIn(root, range.startContainer, (element) => element.matches(selector))
    : blockOf(root, range.startContainer)
  if (!target) return

  if (value === null) target.style.removeProperty(property)
  else target.style.setProperty(property, value)
  if (target.getAttribute('style') === '') target.removeAttribute('style')
}

/** Set or remove an attribute on the nearest matching ancestor. */
export const setAttribute: Command = (root, args) => {
  const { selector, name, value } = (args as {
    selector: string
    name: string
    value: string | null
  }) ?? { selector: '', name: '', value: null }
  if (!selector || !name) return

  const range = currentRange(root)
  if (!range) return
  const target = closestIn(root, range.startContainer, (element) => element.matches(selector))
  if (!target) return

  if (value === null) target.removeAttribute(name)
  else target.setAttribute(name, value)
}

export interface MoveBlockArgs {
  /** Child indices from the root, addressing the block being moved. */
  from: number[]
  /** The block it is being dropped against, or the callout it is dropped into. */
  to: number[]
  position: 'before' | 'after' | 'inside'
}

export interface MoveBlocksArgs extends Omit<MoveBlockArgs, 'from'> {
  /** The blocks being moved, in any order — they land in document order. */
  from: number[][]
}

/**
 * The blocks these paths name, in document order, with the duplicates and the
 * nested ones dropped.
 *
 * A block picked inside another picked block travels with its container anyway;
 * moving it in its own right as well would take it out on the way, which is the
 * one shape a group move must never produce.
 */
function resolveBlocks(root: HTMLElement, paths: number[][]): HTMLElement[] {
  const found = new Set<HTMLElement>()
  for (const path of paths) {
    const element = elementAt(root, path)
    if (element) found.add(element)
  }

  return [...found]
    .filter((element) => ![...found].some((other) => other !== element && other.contains(element)))
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
}

/**
 * Move blocks to another row — what a gutter handle drags, one block or the whole
 * marquee selection.
 *
 * Blocks travel as paths of child indices rather than as nodes: the UI
 * lives on the far side of the editor port and never holds an element. Dropping
 * against a block inside a callout is what moves a block *into* one.
 *
 * They go through a fragment rather than one insertion each, so a group keeps its
 * order however it was picked and whichever side of the target it lands on.
 */
export const moveBlocks: Command = (root, args) => {
  const { from, to, position } = (args as MoveBlocksArgs | undefined) ?? {
    from: [],
    to: [],
    position: 'after',
  }
  const target = elementAt(root, to)
  if (!target) return

  const sources = resolveBlocks(root, from)
  if (sources.length === 0) return
  // Landing on itself is a no-op; landing *inside* itself would take the block
  // out of the document with it.
  if (sources.some((source) => source === target || source.contains(target))) return

  if (position === 'inside') {
    if (!isContainer(target)) return
    // A callout of plain text has no gap to aim at, so dropping on the callout
    // itself means "in here" — and putting a block in it makes it hold blocks.
    if (target.childNodes.length === 1 && target.firstChild?.nodeName === 'BR') {
      target.replaceChildren()
    } else {
      wrapInlineContent(target)
    }
  }

  // A column is only a column inside its own layout. Dragged anywhere else, what
  // travels is the blocks it held — a stray `.column` in the page is nothing.
  const fromLayout = (source: HTMLElement) =>
    isColumn(source) && !(position !== 'inside' && target.parentElement === source.parentElement)
  const moving = sources.flatMap((source) => {
    if (!fromLayout(source)) return [source]
    wrapInlineContent(source)
    const blocks = [...source.children] as HTMLElement[]
    source.remove()
    return blocks
  })
  if (moving.length === 0) return

  const fragment = root.ownerDocument.createDocumentFragment()
  for (const source of moving) fragment.appendChild(source)

  if (position === 'inside') target.appendChild(fragment)
  else if (position === 'before') target.before(fragment)
  else target.after(fragment)

  // Leave the caret in what moved, so the gutter marks it and typing carries on
  // where the eye already is. An image holds no caret, so it keeps the selection.
  const first = moving[0]
  if (!ATOM_TAGS.has(first.tagName)) caretInto(root, first, 0)
}

/** The single-block case, which is every drag that starts outside a selection. */
export const moveBlock: Command = (root, args, options) => {
  const { from, to, position } = (args as MoveBlockArgs | undefined) ?? {
    from: [],
    to: [],
    position: 'after',
  }
  moveBlocks(root, { from: [from], to, position }, options)
}

/**
 * Throw away whole blocks — the marquee selection's Backspace.
 *
 * With no argument it removes what is picked, which is what both the key and the
 * inspector's button mean; an explicit list is there for a caller that already
 * knows the addresses.
 */
export const removeBlocks: Command = (root, args) => {
  const { paths } = (args as { paths?: number[][] } | undefined) ?? {}
  const doomed = resolveBlocks(root, paths ?? pickedPaths(root))
  if (doomed.length === 0) return

  // Somewhere for the caret to go afterwards: the first surviving block after the
  // selection, or failing that the last one before it. A gap in the middle of a
  // non-contiguous selection is not a landing — those go too.
  const going = new Set<Element>(doomed)
  const survivor = (node: Element | null, step: (el: Element) => Element | null) => {
    let current = node
    while (current && going.has(current)) current = step(current)
    return current
  }
  const landing =
    survivor(doomed[doomed.length - 1].nextElementSibling, (el) => el.nextElementSibling) ??
    survivor(doomed[0].previousElementSibling, (el) => el.previousElementSibling)

  for (const element of doomed) element.remove()

  // The normaliser puts a paragraph back when the last block in the document (or
  // in a callout) went with the selection, so there is always somewhere to type.
  if (landing && !ATOM_TAGS.has(landing.tagName)) caretInto(root, landing, 0)
}
