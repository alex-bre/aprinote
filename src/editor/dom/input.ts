import { moveCell, rowBelow } from '../table/ops'
import { htmlFromClipboard } from './sanitize'
import { blockFormAt, emptyParagraph, isColumn, isContainer, splitBlock } from './structure'

/**
 * Input routing and IME.
 *
 * Route `beforeinput` by `inputType` and intercept *only* the cases we are
 * changing. Everything else is left to the browser and cleaned up by the
 * normaliser afterwards.
 *
 * The rule that matters most: **never `preventDefault` on plain text insertion.**
 * That is precisely what breaks IME composition, mobile autocorrect and CJK input.
 * During a composition the normaliser and history snapshots are suspended
 * entirely — rewriting the DOM mid-composition detaches the nodes the IME is
 * still editing, and the input silently breaks.
 */

/** The drag payload the sidebar sets when a page row is dragged. */
export const PAGE_DRAG = 'application/x-aprinote-page'

/** Input types that are the user typing, and must never be intercepted. */
const TYPING = new Set([
  'insertText',
  'insertCompositionText',
  'insertReplacementText',
  'insertFromComposition',
  'deleteByComposition',
  'deleteCompositionText',
])

/** ⌘/Ctrl shortcuts that map straight onto registered commands. */
const SHORTCUTS: Record<string, [command: string, args?: unknown]> = {
  b: ['bold'],
  i: ['italic'],
  u: ['underline'],
}

export interface InputHost {
  root: HTMLElement
  exec: (command: string, args?: unknown) => void
  /** Files dropped or pasted into the document — images become figures. */
  files: (files: File[]) => void
  /** A page dragged out of the sidebar, dropped in as a stable link. */
  pageDrop: (path: string, at: { x: number; y: number }) => void
  /** Snapshot the current state before a mutation lands. */
  before: (kind: 'typing' | 'command') => void
  /** Clean up and record after a mutation. */
  after: (kind: 'typing' | 'command') => void
  undo: () => void
  redo: () => void
  composing: () => boolean
  setComposing: (value: boolean) => void
}

function closest(node: Node | null, root: HTMLElement, match: (el: Element) => boolean): Element | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE && match(current as Element)) return current as Element
    current = current.parentNode
  }
  return null
}

function caretElement(root: HTMLElement): { node: Node; offset: number } | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null
  return { node: range.startContainer, offset: range.startOffset }
}

/** True when the caret sits at the very start of `block`, with nothing before it. */
function atBlockStart(root: HTMLElement, block: Element): boolean {
  const caret = caretElement(root)
  if (!caret) return false
  if (caret.offset !== 0) return false

  const walker = root.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  return !first || first === caret.node || caret.node === block
}

export function attachInput(host: InputHost): () => void {
  const { root } = host
  const doc = root.ownerDocument

  // --- IME composition ------------------------------------------------------
  // Nothing may touch the DOM between these two events.
  const onCompositionStart = () => {
    host.before('typing')
    host.setComposing(true)
  }
  const onCompositionEnd = () => {
    host.setComposing(false)
    // Let the browser finish committing the composed text first.
    queueMicrotask(() => host.after('typing'))
  }

  const onBeforeInput = (event: InputEvent) => {
    const { inputType } = event

    if (inputType === 'historyUndo') {
      event.preventDefault()
      return host.undo()
    }
    if (inputType === 'historyRedo') {
      event.preventDefault()
      return host.redo()
    }

    // Composition owns the DOM until it ends — stay out of the way completely.
    if (host.composing()) return

    if (TYPING.has(inputType)) {
      host.before('typing')
      return // never preventDefault here
    }

    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
      const data = event.dataTransfer
      if (!data) return
      event.preventDefault()

      const files = [...data.files].filter((file) => file.type.startsWith('image/'))
      if (files.length) return host.files(files)

      host.before('command')
      const html = htmlFromClipboard(data, doc)
      if (html) doc.execCommand('insertHTML', false, html)
      host.after('command')
      return
    }

    if (inputType === 'insertParagraph') {
      if (handleEnter(root, host)) event.preventDefault()
      else host.before('command')
      return
    }

    if (inputType.startsWith('delete')) {
      if (guardDelete(root, inputType)) {
        event.preventDefault()
        return
      }
      host.before('command')
      return
    }

    host.before('command')
  }

  const onInput = (event: Event) => {
    if (host.composing()) return
    const inputType = (event as InputEvent).inputType ?? ''
    host.after(TYPING.has(inputType) ? 'typing' : 'command')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey

    if (meta && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      return event.shiftKey ? host.redo() : host.undo()
    }
    if (meta && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      return host.redo()
    }

    const shortcut = meta && !event.altKey ? SHORTCUTS[event.key.toLowerCase()] : undefined
    if (shortcut) {
      event.preventDefault()
      return host.exec(...shortcut)
    }

    // Tab walks table cells, indents inside a list, and is inert elsewhere —
    // never focus navigation.
    if (event.key === 'Tab' && !meta) {
      event.preventDefault()
      host.before('command')
      if (!moveCell(root, event.shiftKey)) host.exec(event.shiftKey ? 'outdent' : 'indent')
      host.after('command')
    }
  }

  const onDragOver = (event: DragEvent) => {
    const types = event.dataTransfer?.types ?? []
    if (types.includes('Files') || types.includes(PAGE_DRAG)) event.preventDefault()
  }
  const onDrop = (event: DragEvent) => {
    const page = event.dataTransfer?.getData(PAGE_DRAG)
    if (page) {
      event.preventDefault()
      return host.pageDrop(page, { x: event.clientX, y: event.clientY })
    }
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    event.preventDefault()
    host.files(files)
  }

  const onBlur = () => host.after('command')

  root.addEventListener('compositionstart', onCompositionStart)
  root.addEventListener('compositionend', onCompositionEnd)
  root.addEventListener('beforeinput', onBeforeInput as EventListener)
  root.addEventListener('input', onInput)
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('dragover', onDragOver)
  root.addEventListener('drop', onDrop)
  root.addEventListener('blur', onBlur)

  return () => {
    root.removeEventListener('compositionstart', onCompositionStart)
    root.removeEventListener('compositionend', onCompositionEnd)
    root.removeEventListener('beforeinput', onBeforeInput as EventListener)
    root.removeEventListener('input', onInput)
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('dragover', onDragOver)
    root.removeEventListener('drop', onDrop)
    root.removeEventListener('blur', onBlur)
  }
}

/** Put the caret at the start of `node`. */
function caretTo(root: HTMLElement, node: Node, offset = 0): void {
  const range = root.ownerDocument.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = root.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Enter on an empty list item leaves the list rather than adding another empty
 * one, and Enter in a callout stays in the callout. Browsers disagree wildly on
 * both, and they are the Enter cases worth owning. Returns true when handled.
 */
function handleEnter(root: HTMLElement, host: InputHost): boolean {
  const caret = caretElement(root)
  if (!caret) return false

  // In a table, Enter grows the table rather than making a paragraph in a cell.
  if (closest(caret.node, root, (el) => el.tagName === 'TD' || el.tagName === 'TH')) {
    host.before('command')
    const handled = rowBelow(root)
    host.after('command')
    return handled
  }

  const item = closest(caret.node, root, (el) => el.tagName === 'LI')
  if (item) return handleListEnter(root, host, item)

  // A code block takes a newline and a caption takes a line break; neither is a
  // block split, so both stay the browser's.
  if (closest(caret.node, root, (el) => el.tagName === 'PRE' || el.tagName === 'FIGCAPTION')) {
    return false
  }

  const container = closest(caret.node, root, isContainer)
  return container ? handleContainerEnter(root, host, container as HTMLElement) : false
}

function handleListEnter(root: HTMLElement, host: InputHost, item: Element): boolean {
  // A list item with text splits natively — that part browsers agree on.
  if (item.textContent !== '') return false

  const list = item.parentElement
  if (!list || (list.tagName !== 'UL' && list.tagName !== 'OL')) return false

  host.before('command')

  const paragraph = emptyParagraph(root.ownerDocument)

  const nested = list.parentElement?.tagName === 'LI'
  if (nested) {
    // Inside a nested list, one Enter outdents a level instead of exiting outright.
    const parentItem = list.parentElement!
    parentItem.after(item)
    item.replaceChildren(root.ownerDocument.createElement('br'))
  } else {
    list.after(paragraph)
    item.remove()
    if (list.children.length === 0) list.remove()
    caretTo(root, paragraph, 0)
  }

  host.after('command')
  return true
}

/**
 * Enter inside a callout continues *within* it. Left to the browser this either
 * cuts the callout in two or drops a bare `<div>` inside it, neither of which is
 * what "next line" means. An empty block at the end is the way out, exactly as an
 * empty item is the way out of a list.
 */
function handleContainerEnter(root: HTMLElement, host: InputHost, container: HTMLElement): boolean {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return false

  host.before('command')
  const range = selection.getRangeAt(0)
  if (!range.collapsed) range.deleteContents()

  const block = blockFormAt(container, range)
  if (!block) {
    host.after('command')
    return false
  }

  if (!block.textContent?.trim() && block === container.lastElementChild) {
    const paragraph = emptyParagraph(root.ownerDocument)
    const layout = isColumn(container) ? container.parentElement : null
    if (layout) {
      // Out of a column is out of the whole layout — a paragraph beside the
      // columns would only become another column. The column keeps its last
      // empty paragraph, so it stays a column rather than collapsing.
      layout.after(paragraph)
      if (container.childElementCount > 1) block.remove()
      caretTo(root, paragraph, 0)
      host.after('command')
      return true
    }
    container.after(paragraph)
    block.remove()
    // Enter out of a callout that held nothing else takes the callout with it.
    if (container.childElementCount === 0) container.remove()
    caretTo(root, paragraph, 0)
    host.after('command')
    return true
  }

  caretTo(root, splitBlock(block, range), 0)
  host.after('command')
  return true
}

/** True when the caret sits at the very end of `block`, with nothing after it. */
function atBlockEnd(root: HTMLElement, block: Element): boolean {
  const caret = caretElement(root)
  if (!caret) return false

  const walker = root.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  let last: Node | null = null
  while (walker.nextNode()) if (walker.currentNode.nodeValue?.trim()) last = walker.currentNode
  if (!last) return true
  return caret.node === last && caret.offset >= (last.nodeValue?.length ?? 0)
}

/**
 * Backspace at the very start of the first block would delete the article's own
 * structure in some browsers. Stop it there; every other delete is the browser's.
 *
 * The same edge exists inside a column: Backspace at the top of one (or Delete at
 * the bottom) would pour it into its neighbour and tear the layout. A column's
 * edges are walls, the way a table cell's are.
 */
function guardDelete(root: HTMLElement, inputType: string): boolean {
  const caret = caretElement(root)
  if (!caret) return false

  const selection = root.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed) return false

  const column = closest(caret.node, root, isColumn)
  if (column) {
    const block = closest(caret.node, root, (el) => el.parentElement === column) ?? column
    if (inputType === 'deleteContentBackward') {
      return (block === column || block === column.firstElementChild) && atBlockStart(root, block)
    }
    if (inputType === 'deleteContentForward') {
      return (block === column || block === column.lastElementChild) && atBlockEnd(root, block)
    }
  }

  const first = root.firstElementChild
  if (!first) return false

  const block = closest(caret.node, root, (el) => el.parentElement === root)
  return block === first && atBlockStart(root, first)
}
