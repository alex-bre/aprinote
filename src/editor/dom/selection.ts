/**
 * Selection paths.
 *
 * A DOM Range is invalidated by almost any mutation, so every other subsystem
 * needs a stable way to say "where the caret is": child indices from the editor
 * root, plus an offset. Serialize before a mutation, restore after.
 *
 * Undo, the normaliser, source-pane sync and every command lean on this, which is
 * why it is the first thing built.
 */

export interface SelectionPath {
  anchor: number[]
  anchorOffset: number
  focus: number[]
  focusOffset: number
}

/** Child indices from `root` down to `node`, or null if it is outside. */
export function pathTo(root: Node, node: Node): number[] | null {
  const path: number[] = []
  let current: Node | null = node

  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) return null
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current))
    current = parent
  }
  return current === root ? path : null
}

/**
 * The node at `path`, clamped. After a mutation the tree may be shorter than the
 * path describes; clamping lands the caret at the nearest surviving position
 * rather than dropping the selection entirely.
 */
export function nodeAt(root: Node, path: number[]): { node: Node; exact: boolean } {
  let node: Node = root
  let exact = true

  for (const index of path) {
    const children = node.childNodes
    if (children.length === 0) return { node, exact: false }
    const at = Math.min(index, children.length - 1)
    if (at !== index) exact = false
    node = children[at]
  }
  return { node, exact }
}

function clampOffset(node: Node, offset: number): number {
  const max = node.nodeType === Node.TEXT_NODE ? (node.nodeValue?.length ?? 0) : node.childNodes.length
  return Math.max(0, Math.min(offset, max))
}

/** Capture the live selection, if it sits inside `root`. */
export function captureSelection(root: HTMLElement): SelectionPath | null {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const { anchorNode, focusNode, anchorOffset, focusOffset } = selection
  if (!anchorNode || !focusNode) return null
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return null

  const anchor = pathTo(root, anchorNode)
  const focus = pathTo(root, focusNode)
  if (!anchor || !focus) return null

  return { anchor, anchorOffset, focus, focusOffset }
}

/** Put the caret back. Returns false when the path could not be resolved at all. */
export function restoreSelection(root: HTMLElement, path: SelectionPath | null): boolean {
  if (!path) return false
  const selection = root.ownerDocument.getSelection()
  if (!selection) return false

  const anchor = nodeAt(root, path.anchor)
  const focus = nodeAt(root, path.focus)

  const range = root.ownerDocument.createRange()
  try {
    range.setStart(anchor.node, clampOffset(anchor.node, path.anchorOffset))
    range.setEnd(focus.node, clampOffset(focus.node, path.focusOffset))
  } catch {
    // Backwards selection, or a node that cannot hold a caret — collapse to anchor.
    try {
      range.setStart(anchor.node, clampOffset(anchor.node, path.anchorOffset))
      range.collapse(true)
    } catch {
      return false
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
  return true
}

/** True when both ends sit in the same place. */
export function isCollapsed(path: SelectionPath): boolean {
  return path.anchorOffset === path.focusOffset && samePath(path.anchor, path.focus)
}

export function samePath(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

export function sameSelection(a: SelectionPath | null, b: SelectionPath | null): boolean {
  if (!a || !b) return a === b
  return (
    a.anchorOffset === b.anchorOffset &&
    a.focusOffset === b.focusOffset &&
    samePath(a.anchor, b.anchor) &&
    samePath(a.focus, b.focus)
  )
}
