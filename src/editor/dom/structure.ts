/**
 * Containers.
 *
 * A callout is a plain `<div class="callout">`, and a `<div>` is the one
 * block in this format that holds other blocks. Saying so in a single place is
 * what lets Enter continue *inside* a callout, a list or an image nest in one,
 * and the gutter name the paragraph you are actually standing in.
 *
 * Everything here is pure DOM surgery over an explicit Range — no reliance on the
 * live selection — so it is testable without a browser.
 */

/** Blocks that may sit directly in the article, or in a container. */
export const BLOCK_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE',
  'PRE', 'TABLE', 'FIGURE', 'HR', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE',
])

/** Blocks the caret cannot enter, so a paragraph must always follow a trailing one. */
export const ATOM_TAGS = new Set(['IMG', 'IFRAME', 'VIDEO', 'HR', 'FIGURE', 'TABLE'])

/**
 * A block that holds other blocks. The normaliser turns every bare `<div>` into a
 * paragraph, so a surviving one is deliberate — a callout, or whatever the user
 * wrote in their own HTML.
 */
export function isContainer(node: Node | null | undefined): node is HTMLElement {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) return false
  const { tagName } = node as Element
  return tagName === 'DIV' || tagName === 'ASIDE' || tagName === 'SECTION'
}

/**
 * A column layout — `<div class="columns">` — whose children are the columns.
 * Structure, not content: nothing is typed into it directly, only into a column.
 */
export function isColumns(node: Node | null | undefined): node is HTMLElement {
  return isContainer(node) && node.classList.contains('columns')
}

/** One column of a layout: a container like a callout, but only inside `.columns`. */
export function isColumn(node: Node | null | undefined): node is HTMLElement {
  return isContainer(node) && node.classList.contains('column') && isColumns(node.parentNode)
}

/** True when a container holds blocks rather than a bare run of inline content. */
export function inBlockForm(container: Element): boolean {
  return [...container.children].some((child) => BLOCK_TAGS.has(child.tagName))
}

/**
 * The nearest block whose parent is `host` or a container inside it — the row a
 * drag moves and the row a new block lands beside. Unlike `blockOf`, this walks
 * *out* of tables and figures, because those are rows in their own right.
 */
export function anchorBlock(host: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== host) {
    const parent: Node | null = current.parentNode
    if (!parent) return null
    if (parent === host || isContainer(parent)) {
      return current.nodeType === Node.ELEMENT_NODE ? (current as HTMLElement) : null
    }
    current = parent
  }
  return null
}

/** What the gutter calls this block. Tag names, except where a tag says nothing. */
export function blockLabel(element: Element): string {
  const tag = element.tagName.toLowerCase()
  if (isContainer(element)) return element.classList[0] || tag
  if (tag === 'figure') {
    if (element.classList.contains('embed')) return 'embed'
    return element.querySelector('img') ? 'img' : 'figure'
  }
  if (tag === 'pre') return 'code'
  return tag
}

/** A paragraph or heading: a block made of a line of text, and nothing else. */
export function isTextBlock(element: Element | null): element is HTMLElement {
  return !!element && /^(P|H[1-6])$/.test(element.tagName)
}

export function emptyParagraph(doc: Document): HTMLElement {
  const paragraph = doc.createElement('p')
  paragraph.appendChild(doc.createElement('br'))
  return paragraph
}

/**
 * The block inside `container` that holds the range, bringing an inline-only
 * container into block form first if it has to.
 *
 * The wrap moves the existing nodes rather than re-creating them, so the caret
 * keeps its place in the text — but every live Range boundary *inside* a node is
 * relocated to that node's old parent when it is removed, which silently walks
 * the caret to the front of the callout. The boundary is therefore taken by hand
 * before the move and put back after, when the same nodes have a new parent.
 */
export function blockFormAt(container: HTMLElement, range: Range): HTMLElement | null {
  const node = range.startContainer
  const offset = range.startOffset

  const paragraph = wrapInlineContent(container)
  if (!paragraph) return anchorBlock(container, node)

  // Children kept their order, so an offset counted on the container still counts.
  if (node === container) range.setStart(paragraph, Math.min(offset, paragraph.childNodes.length))
  else range.setStart(node, offset)
  return paragraph
}

/**
 * Gather a container's inline content into a paragraph, so it holds blocks like
 * any other. Null when it already does. Callers holding a Range must repair it
 * afterwards — see `blockFormAt`.
 */
export function wrapInlineContent(container: HTMLElement): HTMLElement | null {
  if (inBlockForm(container)) return null
  const paragraph = container.ownerDocument.createElement('p')
  while (container.firstChild) paragraph.appendChild(container.firstChild)
  container.appendChild(paragraph)
  return paragraph
}

/**
 * Split `block` at the range, leaving the tail in a new sibling and returning it.
 *
 * A heading cut in half stays two headings; Enter at the end of one starts prose,
 * which is what every editor does and what people expect from a title line.
 */
export function splitBlock(block: HTMLElement, range: Range): HTMLElement {
  const doc = block.ownerDocument
  const tail = doc.createRange()
  tail.setStart(range.startContainer, range.startOffset)
  tail.setEnd(block, block.childNodes.length)
  const contents = tail.extractContents()

  const empty = !contents.textContent?.trim() && !contents.querySelector('img, br')
  const next = doc.createElement(empty ? 'p' : block.tagName.toLowerCase())
  if (!empty) {
    for (const attr of [...block.attributes]) next.setAttribute(attr.name, attr.value)
  }
  next.appendChild(contents)

  // Both halves need their filler back — an empty block with no `<br>` collapses
  // to zero height and cannot be clicked into.
  if (next.childNodes.length === 0) next.appendChild(doc.createElement('br'))
  if (block.childNodes.length === 0) block.appendChild(doc.createElement('br'))

  block.after(next)
  return next
}

/** The child-index path from `root` down to `node` — the inverse of `elementAt`. */
export function pathOf(root: HTMLElement, node: Node): number[] {
  const path: number[] = []
  let current: Node | null = node
  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) return []
    path.unshift([...parent.childNodes].indexOf(current as ChildNode))
    current = parent
  }
  return current === root ? path : []
}

/** The element at a path of child indices from `root`, or null if it is not one. */
export function elementAt(root: HTMLElement, path: number[]): HTMLElement | null {
  let node: Node = root
  for (const index of path) {
    const child: Node | undefined = node.childNodes[index]
    if (!child) return null
    node = child
  }
  return node !== root && node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : null
}
