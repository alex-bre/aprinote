/**
 * Atoms.
 *
 * Images, tables and embeds are blocks the caret cannot meaningfully sit inside,
 * so clicking one *selects* it rather than placing a caret. The selection is a
 * `data-aprinote-selected` marker the stylesheet draws a ring from — an attribute
 * rather than an overlay element, so it survives undo with the rest of the DOM and
 * needs no separate positioning pass.
 *
 * The normaliser's guaranteed trailing paragraph is what stops the caret being
 * trapped after one of these.
 */

export const SELECTED = 'data-aprinote-selected'

/** Blocks that select as a unit. A table is included, but its cells stay editable. */
const ATOM_SELECTOR = 'figure, table, hr, iframe'

export function selectedAtom(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[${SELECTED}]`)
}

export function clearAtom(root: HTMLElement): boolean {
  const current = selectedAtom(root)
  if (!current) return false
  current.removeAttribute(SELECTED)
  return true
}

function atomFor(root: HTMLElement, target: Node | null): HTMLElement | null {
  let node: Node | null = target
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).matches(ATOM_SELECTOR)) {
      return node as HTMLElement
    }
    node = node.parentNode
  }
  return null
}

/**
 * Track which atom is selected. Returns a detach function.
 *
 * Clicking inside a table cell must *not* select the table — cell text is edited
 * natively, which is the whole reason tables get easier under this design.
 */
export function attachAtoms(root: HTMLElement, onChange: () => void): () => void {
  const doc = root.ownerDocument

  const onPointerDown = (event: Event) => {
    const target = event.target as Node | null
    const inCell = !!atomFor(root, target) && !!(target as Element)?.closest?.('td, th')
    const atom = inCell ? null : atomFor(root, target)

    const changed = clearAtom(root)
    if (atom) {
      atom.setAttribute(SELECTED, '')
      // Park the DOM selection inside the atom too. Without this the browser's
      // own selection update lands elsewhere and the guard below immediately
      // clears what we just selected.
      const range = doc.createRange()
      range.selectNodeContents(atom)
      range.collapse(true)
      const selection = doc.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      onChange()
      return
    }
    if (changed) onChange()
  }

  // Any caret movement outside the atom drops the selection.
  const onSelectionChange = () => {
    const selection = doc.getSelection()
    const anchor = selection?.anchorNode
    if (!anchor || !root.contains(anchor)) return
    const current = selectedAtom(root)
    if (current && !current.contains(anchor) && clearAtom(root)) onChange()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const atom = selectedAtom(root)
    if (!atom) return

    if (event.key === 'Escape') {
      clearAtom(root)
      return onChange()
    }
    // Backspace on a selected atom removes it, rather than editing inside it.
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      const after = atom.nextElementSibling ?? atom.previousElementSibling
      atom.remove()
      if (after) {
        const range = doc.createRange()
        range.setStart(after, 0)
        range.collapse(true)
        const selection = doc.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
      onChange()
    }
  }

  root.addEventListener('pointerdown', onPointerDown)
  root.addEventListener('keydown', onKeyDown)
  doc.addEventListener('selectionchange', onSelectionChange)

  return () => {
    root.removeEventListener('pointerdown', onPointerDown)
    root.removeEventListener('keydown', onKeyDown)
    doc.removeEventListener('selectionchange', onSelectionChange)
  }
}
