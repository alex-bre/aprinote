import { clearAtom } from './atoms'
import { elementAt, pathOf } from './structure'

/**
 * The block selection.
 *
 * A box drawn in the page's margins picks whole blocks, so several can be moved
 * or thrown away in one gesture. Like the atom ring next door this is a marker
 * attribute rather than an overlay: the mark travels with the block through a
 * move, survives an undo with the rest of the DOM, and the stylesheet draws the
 * highlight from it — so nothing here needs a positioning pass, and the UI on the
 * far side of the port never has to hold a node to remember what is selected.
 *
 * Editor-only, like `data-aprinote-selected`: the serializer strips it, so a picked
 * block never reaches a file.
 */

export const PICKED = 'data-aprinote-picked'

/** Every picked block, in document order. */
export function pickedElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[${PICKED}]`)]
}

/** The picked blocks' addresses — child-index paths, as every command takes. */
export function pickedPaths(root: HTMLElement): number[][] {
  return pickedElements(root).map((element) => pathOf(root, element))
}

/** Mark exactly these blocks, and nothing else. True when the set changed. */
export function setPicked(root: HTMLElement, paths: number[][]): boolean {
  const wanted = new Set<HTMLElement>()
  for (const path of paths) {
    const element = elementAt(root, path)
    if (element) wanted.add(element)
  }

  let changed = false
  for (const element of pickedElements(root)) {
    if (wanted.has(element)) continue
    element.removeAttribute(PICKED)
    changed = true
  }
  for (const element of wanted) {
    if (element.hasAttribute(PICKED)) continue
    element.setAttribute(PICKED, '')
    changed = true
  }
  return changed
}

export function clearPicked(root: HTMLElement): boolean {
  return setPicked(root, [])
}

export interface PickedHost {
  /** Run a registered command, so removing the picked blocks is undoable. */
  exec: (command: string, args?: unknown) => void
  onChange: () => void
}

/**
 * The keys a block selection answers to. Returns a detach function.
 *
 * Backspace is intercepted at `keydown` rather than at `beforeinput`, because
 * preventing the key's default is what stops the browser generating the delete in
 * the first place — the same trick the atom ring uses one file over.
 */
export function attachPicked(root: HTMLElement, host: PickedHost): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (pickedElements(root).length === 0) return

    if (event.key === 'Escape') {
      event.preventDefault()
      if (clearPicked(root)) host.onChange()
      return
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      host.exec('removeBlocks')
    }
  }

  // Typing anywhere ends the selection: leaving it lit would leave the next
  // Backspace meaning something the highlight no longer explains. This listener
  // is registered before the input router's, so the mark is already gone when the
  // history snapshot for the edit is taken.
  const onBeforeInput = () => {
    if (clearPicked(root)) host.onChange()
  }

  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('beforeinput', onBeforeInput)

  return () => {
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('beforeinput', onBeforeInput)
  }
}

/**
 * Replace the selection from outside the editor.
 *
 * Two selections with a claim on the same Backspace is one too many, so picking
 * blocks drops the atom ring and collapses any run of selected text — otherwise
 * the floating bar would sit over a highlight that is no longer what the keys act
 * on.
 */
export function pick(root: HTMLElement, paths: number[][]): boolean {
  if (paths.length === 0) return setPicked(root, [])

  const dropped = clearAtom(root)
  const selection = root.ownerDocument.getSelection()
  if (selection && !selection.isCollapsed && root.contains(selection.anchorNode)) {
    selection.collapseToStart()
  }
  return setPicked(root, paths) || dropped
}
