/**
 * Range surgery shared by the hand-written commands.
 *
 * `execCommand` handles lists and inline marks and does this work for
 * free. Everything else — colour, alignment, links — is hand-written because
 * execCommand's output there is bad or browser-divergent, and these are the
 * primitives those commands are built from.
 */

const BLOCK = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE',
  'TD', 'TH', 'FIGCAPTION', 'DD', 'DT',
])

export function currentRange(root: HTMLElement): Range | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return root.contains(range.commonAncestorContainer) ? range : null
}

export function selectRange(root: HTMLElement, range: Range): void {
  const selection = root.ownerDocument.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

/**
 * Split the text nodes at both ends so the range covers whole nodes. End first —
 * splitting the start would shift the end offset out from under us.
 */
export function splitBoundaries(range: Range): void {
  const { endContainer, endOffset } = range
  if (endContainer.nodeType === Node.TEXT_NODE) {
    const text = endContainer as Text
    if (endOffset > 0 && endOffset < text.length) {
      text.splitText(endOffset)
      range.setEnd(text, text.length)
    }
  }

  const { startContainer, startOffset } = range
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const text = startContainer as Text
    if (startOffset > 0 && startOffset < text.length) {
      const tail = text.splitText(startOffset)
      range.setStart(tail, 0)
    }
  }
}

/** Every non-empty text node the range touches. */
export function textNodesIn(range: Range): Text[] {
  const root = range.commonAncestorContainer
  const doc = root.ownerDocument ?? (root as Document)
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []

  // A range wholly inside one text node has that node as its commonAncestor,
  // which a TreeWalker rooted there will not itself visit.
  if (root.nodeType === Node.TEXT_NODE) return (root.nodeValue ?? '') ? [root as Text] : []

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue) continue
    if (range.intersectsNode(node)) nodes.push(node as Text)
  }
  return nodes.filter((node) => {
    // intersectsNode is true for nodes merely adjacent to the boundaries.
    const probe = doc.createRange()
    probe.selectNodeContents(node)
    return (
      range.compareBoundaryPoints(Range.END_TO_START, probe) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, probe) > 0
    )
  })
}

/**
 * Wrap every text node in the range with a fresh element. Adjacent identical
 * wrappers are left for the normaliser to merge — it already does that job.
 */
export function wrapEach(range: Range, make: () => HTMLElement): void {
  splitBoundaries(range)
  const nodes = textNodesIn(range)
  if (nodes.length === 0) return

  const wrapped: HTMLElement[] = []
  for (const node of nodes) {
    const wrapper = make()
    node.parentNode?.insertBefore(wrapper, node)
    wrapper.appendChild(node)
    wrapped.push(wrapper)
  }

  range.setStartBefore(wrapped[0])
  range.setEndAfter(wrapped[wrapped.length - 1])
}

/** Strip matching ancestors from every text node in the range. */
export function unwrapAround(
  root: HTMLElement,
  range: Range,
  matches: (element: Element) => boolean,
): void {
  splitBoundaries(range)
  const nodes = textNodesIn(range)
  const targets = new Set<Element>()

  for (const node of nodes) {
    let current = node.parentElement
    while (current && current !== root) {
      if (matches(current)) targets.add(current)
      current = current.parentElement
    }
  }

  for (const element of targets) {
    const parent = element.parentNode
    if (!parent) continue
    while (element.firstChild) parent.insertBefore(element.firstChild, element)
    element.remove()
  }
}

/** The nearest block ancestor of a node, stopping at the editor root. */
export function blockOf(root: HTMLElement, node: Node): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE && BLOCK.has((current as Element).tagName)) {
      return current as HTMLElement
    }
    current = current.parentNode
  }
  // Direct children of the root count as blocks even if unrecognised.
  current = node
  while (current && current.parentNode !== root) current = current.parentNode
  return current?.nodeType === Node.ELEMENT_NODE ? (current as HTMLElement) : null
}

/** Every block the range touches. */
export function blocksIn(root: HTMLElement, range: Range): HTMLElement[] {
  const nodes = textNodesIn(range)
  const blocks = new Set<HTMLElement>()

  if (nodes.length === 0) {
    const block = blockOf(root, range.startContainer)
    if (block) blocks.add(block)
    return [...blocks]
  }

  for (const node of nodes) {
    const block = blockOf(root, node)
    if (block) blocks.add(block)
  }
  return [...blocks]
}

/** The nearest ancestor matching `predicate`, or null. */
export function closestIn(
  root: HTMLElement,
  node: Node | null,
  predicate: (element: Element) => boolean,
): HTMLElement | null {
  let current: Node | null = node
  while (current && current !== root) {
    if (current.nodeType === Node.ELEMENT_NODE && predicate(current as Element)) {
      return current as HTMLElement
    }
    current = current.parentNode
  }
  return null
}
