import { commands, type Command } from '../EditorSurface'
import { anchorBlock, isContainer } from '../dom/structure'
import { tableCommands } from '../table/ops'
import {
  insertCallout,
  insertCodeBlock,
  insertColumns,
  insertDivider,
  insertEmbed,
  insertFigure,
  insertTable,
  moveBlock,
  moveBlocks,
  removeBlocks,
  setAttribute,
  setColumns,
  styleBlock,
} from './blocks'
import { insertPageLink } from './pagelink'
import { blocksIn, closestIn, currentRange, selectRange, unwrapAround, wrapEach } from './range'

/**
 * The command layer.
 *
 * `execCommand` is deprecated but universally implemented, and no browser can
 * remove it without breaking the web. It is used where it earns its keep — lists
 * and inline marks, where it does genuinely hard Range surgery for free — and the
 * normaliser runs over its output immediately afterwards (that happens in
 * `EditorSurface.exec`, so every command gets it).
 *
 * Everything else is hand-written, because execCommand's output there is bad or
 * browser-divergent. Keeping it all behind this registry means execCommand is an
 * implementation detail that can be retired per command, without touching callers.
 */

export type BlockTag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'blockquote'
export type Align = 'left' | 'center' | 'right' | 'justify'
export type ListKind = 'ul' | 'ol'

const HEADINGS: BlockTag[] = ['p', 'h1', 'h2', 'h3', 'h4', 'blockquote']

/**
 * Emit tags, not inline styles: with styleWithCSS on, Chromium writes
 * `<span style="font-weight:bold">` where we want `<strong>`.
 */
function useTags(doc: Document): void {
  try {
    doc.execCommand('styleWithCSS', false, 'false')
  } catch {
    // Older engines throw on the query; the default is already what we want.
  }
}

function exec(root: HTMLElement, command: string, value?: string): void {
  const doc = root.ownerDocument
  useTags(doc)
  doc.execCommand(command, false, value)
}

// --- inline marks -----------------------------------------------------------
// execCommand does the Range splitting; the normaliser maps b→strong, i→em.

const mark = (name: string): Command => (root) => exec(root, name)

// --- blocks -----------------------------------------------------------------

const setBlock: Command = (root, args) => {
  const tag = args as BlockTag
  if (!HEADINGS.includes(tag)) return
  exec(root, 'formatBlock', `<${tag}>`)
}

// --- alignment --------------------------------------------------------------
// Hand-written: execCommand's justify* commands emit `align` attributes and
// stray divs. Setting the block's own text-align is exact and canonical.

const setAlign: Command = (root, args) => {
  const align = args as Align
  const range = currentRange(root)
  if (!range) return

  for (const block of blocksIn(root, range)) {
    if (align === 'left') block.style.removeProperty('text-align')
    else block.style.textAlign = align
    if (block.getAttribute('style') === '') block.removeAttribute('style')
  }
}

// --- lists ------------------------------------------------------------------

/**
 * Chromium lifts a new list *out* of the `<div>` it was made in, so a list made
 * inside a callout lands after it. execCommand still does the hard part — the
 * item splitting — so the list is simply put back where the block it replaced
 * was, in the same spirit as every other fix-up around it.
 */
const toggleList: Command = (root, args) => {
  const range = currentRange(root)
  const block = range ? anchorBlock(root, range.startContainer) : null
  const container = block?.parentElement
  const nested = !!block && !!container && isContainer(container)
  const after = nested ? block.previousElementSibling : null

  exec(root, args === 'ol' ? 'insertOrderedList' : 'insertUnorderedList')
  if (!nested || !container) return

  const caret = currentRange(root)
  const item = caret ? closestIn(root, caret.startContainer, (el) => el.tagName === 'LI') : null
  const list = item?.parentElement
  // No item at the caret means the list was toggled *off*, which needs no help.
  if (!list || container.contains(list)) return

  const node = caret!.startContainer
  const offset = caret!.startOffset
  if (after) after.after(list)
  else container.prepend(list)

  // Moving the list relocates every live Range boundary inside it to the list's
  // old parent, so the caret has to be re-anchored to the node it was really in.
  const restored = root.ownerDocument.createRange()
  restored.setStart(node, offset)
  restored.collapse(true)
  selectRange(root, restored)
}

/** Indent and outdent are list-only; elsewhere execCommand emits blockquotes. */
const indent = (direction: 'indent' | 'outdent'): Command => (root) => {
  const range = currentRange(root)
  if (!range) return
  if (!closestIn(root, range.startContainer, (el) => el.tagName === 'LI')) return
  exec(root, direction)
}

// --- colour -----------------------------------------------------------------
// Hand-written: `foreColor` still emits `<font>` in places.

function colorCommand(property: 'color' | 'backgroundColor'): Command {
  return (root, args) => {
    const value = (args as string | null) ?? null
    const range = currentRange(root)
    if (!range || range.collapsed) return

    // Clear any existing value first so toggling a colour off really removes it,
    // and so re-colouring does not nest span inside span.
    unwrapAround(
      root,
      range,
      (el) => el.tagName === 'SPAN' && !!(el as HTMLElement).style[property],
    )

    if (value) {
      wrapEach(range, () => {
        const span = root.ownerDocument.createElement('span')
        span.style[property] = value
        return span
      })
    }
    selectRange(root, range)
  }
}

// --- links ------------------------------------------------------------------

const setLink: Command = (root, args) => {
  const href = (args as string | null) ?? null
  const range = currentRange(root)
  if (!range) return

  const existing = closestIn(root, range.startContainer, (el) => el.tagName === 'A')
  if (existing && !href) {
    const parent = existing.parentNode
    while (existing.firstChild) parent?.insertBefore(existing.firstChild, existing)
    existing.remove()
    return
  }
  if (!href) return

  if (existing) {
    existing.setAttribute('href', href)
    return
  }
  if (range.collapsed) return

  wrapEach(range, () => {
    const anchor = root.ownerDocument.createElement('a')
    anchor.setAttribute('href', href)
    // External links open away from the app; page links will not.
    if (/^https?:/i.test(href)) {
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
    }
    return anchor
  })
  selectRange(root, range)
}

// --- clear ------------------------------------------------------------------

const clearFormatting: Command = (root) => {
  const range = currentRange(root)
  if (!range || range.collapsed) return
  exec(root, 'removeFormat')
  unwrapAround(root, range, (el) => el.tagName === 'SPAN')
}

let registered = false

/** Register every formatting command. Idempotent. */
export function registerCommands(): void {
  if (registered) return
  registered = true

  commands.set('bold', mark('bold'))
  commands.set('italic', mark('italic'))
  commands.set('underline', mark('underline'))
  commands.set('strikethrough', mark('strikeThrough'))
  commands.set('block', setBlock)
  commands.set('align', setAlign)
  commands.set('list', toggleList)
  commands.set('indent', indent('indent'))
  commands.set('outdent', indent('outdent'))
  commands.set('color', colorCommand('color'))
  commands.set('background', colorCommand('backgroundColor'))
  commands.set('link', setLink)
  commands.set('pageLink', insertPageLink)
  commands.set('clearFormatting', clearFormatting)

  // Rich blocks
  commands.set('divider', insertDivider)
  commands.set('callout', insertCallout)
  commands.set('columns', insertColumns)
  commands.set('setColumns', setColumns)
  commands.set('codeBlock', insertCodeBlock)
  commands.set('table', insertTable)
  commands.set('embed', insertEmbed)
  commands.set('figure', insertFigure)
  commands.set('moveBlock', moveBlock)
  commands.set('moveBlocks', moveBlocks)
  commands.set('removeBlocks', removeBlocks)
  commands.set('styleBlock', styleBlock)
  commands.set('setAttribute', setAttribute)
  for (const [name, run] of Object.entries(tableCommands)) commands.set(name, run)
}

export { commands }
