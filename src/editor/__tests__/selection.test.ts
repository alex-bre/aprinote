import { beforeEach, describe, expect, it } from 'vitest'
import {
  captureSelection,
  nodeAt,
  pathTo,
  restoreSelection,
  sameSelection,
  type SelectionPath,
} from '../dom/selection'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  document.body.replaceChildren(root)
})

/** Put the caret in the text of the nth block, at `offset`. */
function place(blockIndex: number, offset: number): void {
  const text = root.children[blockIndex].firstChild!
  const range = document.createRange()
  range.setStart(text, offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('pathTo / nodeAt', () => {
  it('round-trips a path through the tree', () => {
    root.innerHTML = '<p>one</p><ul><li>a</li><li>b</li></ul>'
    const target = root.querySelectorAll('li')[1].firstChild!

    const path = pathTo(root, target)
    expect(path).toEqual([1, 1, 0])
    expect(nodeAt(root, path!)).toEqual({ node: target, exact: true })
  })

  it('returns an empty path for the root itself', () => {
    expect(pathTo(root, root)).toEqual([])
  })

  it('refuses a node outside the root', () => {
    const outside = document.createElement('div')
    document.body.append(outside)
    expect(pathTo(root, outside)).toBeNull()
  })

  it('clamps a path the tree has outgrown', () => {
    root.innerHTML = '<p>one</p><p>two</p><p>three</p>'
    const deep = pathTo(root, root.children[2].firstChild!)!

    root.innerHTML = '<p>one</p>'
    const landed = nodeAt(root, deep)
    expect(landed.exact).toBe(false)
    expect(landed.node.nodeValue).toBe('one')
  })

  it('stops cleanly when the path runs past a leaf', () => {
    root.innerHTML = '<p>a</p>'
    expect(nodeAt(root, [0, 0, 5, 5]).exact).toBe(false)
  })
})

describe('capture / restore', () => {
  it('survives an innerHTML replacement with identical structure', () => {
    root.innerHTML = '<p>hello</p><p>world</p>'
    place(1, 3)

    const captured = captureSelection(root)
    expect(captured).toEqual({ anchor: [1, 0], anchorOffset: 3, focus: [1, 0], focusOffset: 3 })

    // This is what undo does — the nodes are all new objects afterwards.
    root.innerHTML = '<p>hello</p><p>world</p>'
    expect(restoreSelection(root, captured)).toBe(true)
    expect(sameSelection(captureSelection(root), captured)).toBe(true)
  })

  it('restores a range that spans two blocks', () => {
    root.innerHTML = '<p>hello</p><p>world</p>'
    const range = document.createRange()
    range.setStart(root.children[0].firstChild!, 1)
    range.setEnd(root.children[1].firstChild!, 4)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    const captured = captureSelection(root)!
    expect(captured.anchor).toEqual([0, 0])
    expect(captured.focus).toEqual([1, 0])

    root.innerHTML = '<p>hello</p><p>world</p>'
    restoreSelection(root, captured)
    expect(captureSelection(root)).toEqual(captured)
  })

  it('clamps an offset the text can no longer hold', () => {
    root.innerHTML = '<p>a long line</p>'
    place(0, 9)
    const captured = captureSelection(root)!

    root.innerHTML = '<p>ab</p>'
    expect(restoreSelection(root, captured)).toBe(true)
    expect(captureSelection(root)!.anchorOffset).toBe(2)
  })

  it('ignores a selection outside the editor', () => {
    root.innerHTML = '<p>inside</p>'
    const outside = document.createElement('p')
    outside.textContent = 'outside'
    document.body.append(outside)

    const range = document.createRange()
    range.setStart(outside.firstChild!, 1)
    range.collapse(true)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)

    expect(captureSelection(root)).toBeNull()
  })

  it('treats a null path as nothing to restore', () => {
    expect(restoreSelection(root, null)).toBe(false)
  })
})

describe('sameSelection', () => {
  it('compares by value, not identity', () => {
    const a: SelectionPath = { anchor: [0, 0], anchorOffset: 1, focus: [0, 0], focusOffset: 1 }
    expect(sameSelection(a, { ...a, anchor: [0, 0] })).toBe(true)
    expect(sameSelection(a, { ...a, anchorOffset: 2 })).toBe(false)
    expect(sameSelection(a, null)).toBe(false)
    expect(sameSelection(null, null)).toBe(true)
  })
})
