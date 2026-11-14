import { pickedElements } from '../dom/picked'
import type { Align, BlockTag, ListKind } from './index'
import { isColumns } from '../dom/structure'
import { blockOf, closestIn, currentRange } from './range'

/** The kind of block the inspector is showing controls for. */
export type AtomKind = 'image' | 'table' | 'embed' | null

/** What the floating bar and the inspector's Text panel light up from. */
export interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  block: BlockTag | null
  align: Align
  list: ListKind | null
  link: string | null
  color: string | null
  background: string | null
  /** True when there is nothing selected — the floating bar stays hidden. */
  collapsed: boolean
  /** Viewport rect of the selection, for positioning. */
  rect: DOMRect | null
  /** A selected image, table or embed — the inspector swaps panels on this. */
  atom: AtomKind
  /** How many blocks a marquee has picked out — 0 when there is no selection. */
  picked: number
  /** True when the caret sits inside a callout, at any depth. */
  callout: boolean
  /** The callout's own background, when it has been given one of its own. */
  calloutColor: string | null
  /** How many columns the layout around the caret has — 0 outside one. */
  columns: number
}

export const EMPTY_STATE: FormatState = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  block: null,
  align: 'left',
  list: null,
  link: null,
  color: null,
  background: null,
  collapsed: true,
  rect: null,
  atom: null,
  picked: 0,
  callout: false,
  calloutColor: null,
  columns: 0,
}

const BLOCK_TAGS: Record<string, BlockTag> = {
  P: 'p',
  H1: 'h1',
  H2: 'h2',
  H3: 'h3',
  H4: 'h4',
  BLOCKQUOTE: 'blockquote',
}

/**
 * A colour written on the text itself rather than on the block around it.
 *
 * The colour commands emit spans *inside* the block, so the search stops there:
 * without that, a callout's own background — which the inspector now lets people
 * set — would read back as a highlight on whatever text the caret is in, and the
 * Background swatch would light up for a colour it did not put there.
 */
function inlineColor(
  node: Node,
  block: Element | null,
  property: 'color' | 'backgroundColor',
): string | null {
  let current: Node | null = node
  while (current && current !== block) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const value = (current as HTMLElement).style?.[property]
      if (value) return value
    }
    current = current.parentNode
  }
  return null
}

function queryCommand(doc: Document, name: string): boolean {
  try {
    return doc.queryCommandState(name)
  } catch {
    return false
  }
}

/**
 * Read the formatting at the caret. Marks come from `queryCommandState` — the one
 * part of execCommand with no good replacement — and everything hand-written is
 * read back off the DOM.
 */
export function queryState(root: HTMLElement): FormatState {
  const selected = root.querySelector<HTMLElement>('[data-aprinote-selected]')
  const atom: AtomKind = selected
    ? selected.tagName === 'TABLE'
      ? 'table'
      : selected.classList.contains('embed')
        ? 'embed'
        : 'image'
    : null

  const picked = pickedElements(root).length

  const range = currentRange(root)
  // A clicked image holds no caret, so the atom has to survive an absent range.
  if (!range) return { ...EMPTY_STATE, atom, picked }

  const doc = root.ownerDocument
  const node = range.startContainer
  const block = blockOf(root, node)
  const listItem = closestIn(root, node, (el) => el.tagName === 'LI')
  const list = listItem?.parentElement
  const anchor = closestIn(root, node, (el) => el.tagName === 'A')

  // The callout the caret is standing in — at any depth, so a paragraph inside one
  // still colours the callout around it rather than nothing at all.
  const callout = closestIn(root, node, (el) => el.classList.contains('callout'))

  // The innermost layout, which is the one the inspector's column count acts on.
  const layout = closestIn(root, node, isColumns)

  const colored = inlineColor(node, block ?? root, 'color')
  const highlighted = inlineColor(node, block ?? root, 'backgroundColor')

  const alignSource = listItem ?? block
  const declared = alignSource?.style.textAlign || ''
  const align: Align = declared === 'center' || declared === 'right' || declared === 'justify'
    ? declared
    : 'left'

  return {
    bold: queryCommand(doc, 'bold'),
    italic: queryCommand(doc, 'italic'),
    underline: queryCommand(doc, 'underline'),
    strikethrough: queryCommand(doc, 'strikeThrough'),
    block: block ? (BLOCK_TAGS[block.tagName] ?? null) : null,
    align,
    list: list?.tagName === 'OL' ? 'ol' : list?.tagName === 'UL' ? 'ul' : null,
    link: anchor?.getAttribute('href') ?? null,
    color: colored,
    background: highlighted,
    collapsed: range.collapsed,
    rect: range.collapsed ? null : range.getBoundingClientRect(),
    atom,
    picked,
    callout: !!callout,
    calloutColor: callout?.style.backgroundColor || null,
    columns: layout ? [...layout.children].filter((child) => child.classList.contains('column')).length : 0,
  }
}

/** CSS colours come back as `rgb(...)`; compare against palette hexes. */
export function sameColor(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b
  return toRgb(a) === toRgb(b)
}

function toRgb(value: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!hex) return value.replace(/\s+/g, '').toLowerCase()
  const n = parseInt(hex[1], 16)
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
}
