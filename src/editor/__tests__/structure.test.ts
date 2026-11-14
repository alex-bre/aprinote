import { beforeEach, describe, expect, it } from 'vitest'
import { moveBlock, moveBlocks, removeBlocks, styleBlock } from '../commands/blocks'
import { queryState, sameColor } from '../commands/state'
import { normalize } from '../dom/normalize'
import { outline } from '../dom/outline'
import { clearPicked, pickedPaths, setPicked } from '../dom/picked'
import { serializeFragment } from '../dom/serialize'
import { anchorBlock, blockFormAt, blockLabel, inBlockForm, splitBlock } from '../dom/structure'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  root.className = 'aprinote-page'
  document.body.replaceChildren(root)
})

/** Normalise `html` and return the result without the guaranteed trailing paragraph. */
function run(html: string): string {
  root.innerHTML = html
  normalize(root)
  return root.innerHTML.replace(/<p><br><\/p>$/, '')
}

/** A collapsed range at an offset inside the first text node of `selector`. */
function caret(selector: string, offset: number): Range {
  const host = root.querySelector(selector)!
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const text = walker.nextNode()
  const range = document.createRange()
  range.setStart(text ?? host, offset)
  range.collapse(true)
  return range
}

/** Put the caret where `caret` says, so the commands can read the live selection. */
function select(range: Range): void {
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

describe('callouts hold blocks', () => {
  it('leaves a callout of plain inline content exactly as written', () => {
    // The common shape in real files — rewriting it on open would churn every
    // document that has one.
    expect(run('<div class="callout">note</div>')).toBe('<div class="callout">note</div>')
  })

  it('gives loose text in a block-form callout a paragraph of its own', () => {
    expect(run('<div class="callout"><p>one</p>two</div>')).toBe(
      '<div class="callout"><p>one</p><p>two</p></div>',
    )
  })

  it('keeps a caret target in an emptied callout', () => {
    expect(run('<div class="callout"></div>')).toBe('<div class="callout"><br></div>')
  })

  it('adds somewhere to type after an image at the end of a callout', () => {
    expect(run('<div class="callout"><p>see</p><figure><img src="a.png"></figure></div>')).toBe(
      '<div class="callout"><p>see</p><figure><img src="a.png"></figure><p><br></p></div>',
    )
  })

  it('is idempotent — a second pass changes nothing', () => {
    const once = run('<div class="callout"><p>one</p>two</div>')
    expect(run(once)).toBe(once)
  })

  it('still nests a list inside the item it hangs off, inside a callout', () => {
    expect(run('<div class="callout"><ul><li>one</li><ul><li>two</li></ul></ul></div>')).toBe(
      '<div class="callout"><ul><li>one<ul><li>two</li></ul></li></ul></div>',
    )
  })
})

describe('the block a gesture acts on', () => {
  it('is the paragraph inside a callout, not the callout', () => {
    root.innerHTML = '<div class="callout"><p>one</p></div>'
    const text = root.querySelector('p')!.firstChild!
    expect(anchorBlock(root, text)?.tagName).toBe('P')
  })

  it('walks out of a table cell to the table itself', () => {
    root.innerHTML = '<table><tr><td>cell</td></tr></table>'
    const text = root.querySelector('td')!.firstChild!
    expect(anchorBlock(root, text)?.tagName).toBe('TABLE')
  })
})

describe('Enter inside a callout', () => {
  it('brings an inline-only callout into block form around the caret', () => {
    root.innerHTML = '<div class="callout">note</div>'
    const container = root.querySelector<HTMLElement>('.callout')!
    const block = blockFormAt(container, caret('.callout', 2))

    expect(block?.tagName).toBe('P')
    expect(inBlockForm(container)).toBe(true)
    expect(container.innerHTML).toBe('<p>note</p>')
  })

  it('splits the block at the caret, leaving both halves in the callout', () => {
    root.innerHTML = '<div class="callout"><p>note</p></div>'
    const range = caret('.callout p', 2)
    const next = splitBlock(root.querySelector('p')!, range)

    expect(next.tagName).toBe('P')
    expect(root.innerHTML).toBe('<div class="callout"><p>no</p><p>te</p></div>')
  })

  it('carries the inline formatting of the half it took with it', () => {
    root.innerHTML = '<div class="callout"><p>a<strong>bold</strong></p></div>'
    const strong = root.querySelector('strong')!
    const range = document.createRange()
    range.setStart(strong.firstChild!, 2)
    range.collapse(true)
    splitBlock(root.querySelector('p')!, range)

    expect(root.innerHTML).toBe(
      '<div class="callout"><p>a<strong>bo</strong></p><p><strong>ld</strong></p></div>',
    )
  })

  it('starts prose after a heading rather than a second heading', () => {
    root.innerHTML = '<div class="callout"><h2>Title</h2></div>'
    const heading = root.querySelector('h2')!
    const range = caret('.callout h2', 5)
    expect(splitBlock(heading, range).tagName).toBe('P')
  })

  it('keeps a heading a heading when it is cut in half', () => {
    root.innerHTML = '<div class="callout"><h2>Title</h2></div>'
    const range = caret('.callout h2', 2)
    expect(splitBlock(root.querySelector('h2')!, range).tagName).toBe('H2')
  })
})

describe('the outline the gutter draws', () => {
  it('names blocks by what they are, and nests a callout’s children', () => {
    root.innerHTML =
      '<h1>Title</h1><div class="callout"><p>note</p><ul><li>one</li></ul></div><figure><img src="a.png"></figure>'
    const rows = outline(root)

    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ['h1', 0],
      ['callout', 0],
      ['p', 1],
      ['ul', 1],
      ['img', 0],
    ])
  })

  it('addresses every row by child index, so a path names one block', () => {
    root.innerHTML = '<p>a</p><div class="callout"><p>b</p></div>'
    expect(outline(root).map((row) => row.path)).toEqual([[0], [1], [1, 0]])
  })

  it('says which rows can hold other rows', () => {
    root.innerHTML = '<p>a</p><div class="callout">note</div>'
    expect(outline(root).map((row) => row.container)).toEqual([false, true])
  })

  it('marks the innermost block holding the caret', () => {
    root.innerHTML = '<p>a</p><div class="callout"><p>b</p></div>'
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(caret('.callout p', 1))

    const active = outline(root).filter((row) => row.active)
    expect(active.map((row) => row.path)).toEqual([[1, 0]])
  })

  it('calls a code block code and an embed an embed', () => {
    root.innerHTML = '<pre><code>x</code></pre><figure class="embed"><iframe></iframe></figure>'
    expect(outline(root).map((row) => row.label)).toEqual(['code', 'embed'])
    expect(blockLabel(root.querySelector('figure')!)).toBe('embed')
  })
})

describe('moving a block', () => {
  it('drops it after another top-level block', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p>'
    moveBlock(root, { from: [0], to: [2], position: 'after' })
    expect(root.innerHTML).toBe('<p>b</p><p>c</p><p>a</p>')
  })

  it('drops it into a callout, addressed by the block already in there', () => {
    root.innerHTML = '<p>a</p><div class="callout"><p>b</p></div>'
    moveBlock(root, { from: [0], to: [1, 0], position: 'after' })
    expect(root.innerHTML).toBe('<div class="callout"><p>b</p><p>a</p></div>')
  })

  it('lifts a block out of a callout again', () => {
    root.innerHTML = '<div class="callout"><p>a</p><p>b</p></div><p>c</p>'
    moveBlock(root, { from: [0, 1], to: [1], position: 'before' })
    expect(root.innerHTML).toBe('<div class="callout"><p>a</p></div><p>b</p><p>c</p>')
  })

  it('drops a block straight into a callout of plain text', () => {
    root.innerHTML = '<div class="callout">note</div><p>a</p>'
    moveBlock(root, { from: [1], to: [0], position: 'inside' })
    // The callout has to hold blocks now, so its own text becomes one.
    expect(root.innerHTML).toBe('<div class="callout"><p>note</p><p>a</p></div>')
  })

  it('drops a block into an empty callout without keeping its filler', () => {
    root.innerHTML = '<div class="callout"><br></div><p>a</p>'
    moveBlock(root, { from: [1], to: [0], position: 'inside' })
    expect(root.innerHTML).toBe('<div class="callout"><p>a</p></div>')
  })

  it('will not drop a block inside something that is not a callout', () => {
    const before = '<p>a</p><p>b</p>'
    root.innerHTML = before
    moveBlock(root, { from: [0], to: [1], position: 'inside' })
    expect(root.innerHTML).toBe(before)
  })

  it('refuses to move a callout inside itself', () => {
    const before = '<div class="callout"><p>a</p></div>'
    root.innerHTML = before
    moveBlock(root, { from: [0], to: [0, 0], position: 'after' })
    expect(root.innerHTML).toBe(before)
  })

  it('ignores an address that no longer names a block', () => {
    const before = '<p>a</p>'
    root.innerHTML = before
    moveBlock(root, { from: [0], to: [7], position: 'after' })
    expect(root.innerHTML).toBe(before)
  })
})

describe('moving several blocks at once', () => {
  it('keeps them in document order however they were picked', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p><p>d</p>'
    moveBlocks(root, { from: [[2], [0]], to: [3], position: 'after' })
    expect(root.innerHTML).toBe('<p>b</p><p>d</p><p>a</p><p>c</p>')
  })

  it('carries a group into a callout', () => {
    root.innerHTML = '<p>a</p><p>b</p><div class="callout"><p>c</p></div>'
    moveBlocks(root, { from: [[0], [1]], to: [2], position: 'inside' })
    expect(root.innerHTML).toBe('<div class="callout"><p>c</p><p>a</p><p>b</p></div>')
  })

  it('leaves a block picked inside another to travel with its container', () => {
    root.innerHTML = '<div class="callout"><p>a</p></div><p>b</p>'
    // The callout and the paragraph in it, as a marquee over both would name them.
    moveBlocks(root, { from: [[0], [0, 0]], to: [1], position: 'after' })
    expect(root.innerHTML).toBe('<p>b</p><div class="callout"><p>a</p></div>')
  })

  it('does nothing when the drop lands on one of the blocks being moved', () => {
    const before = '<p>a</p><p>b</p><p>c</p>'
    root.innerHTML = before
    moveBlocks(root, { from: [[0], [1]], to: [1], position: 'after' })
    expect(root.innerHTML).toBe(before)
  })
})

describe('removing the picked blocks', () => {
  it('takes every one of them and leaves the caret after the last', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p><p>d</p>'
    setPicked(root, [[1], [2]])
    removeBlocks(root)
    expect(root.innerHTML).toBe('<p>a</p><p>d</p>')
    expect(document.getSelection()?.anchorNode).toBe(root.lastElementChild)
  })

  it('falls back to the block before when the selection ran to the end', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p>'
    removeBlocks(root, { paths: [[1], [2]] })
    expect(root.innerHTML).toBe('<p>a</p>')
    expect(document.getSelection()?.anchorNode).toBe(root.firstElementChild)
  })

  it('empties the document when everything was picked', () => {
    root.innerHTML = '<p>a</p><div class="callout"><p>b</p></div>'
    setPicked(root, [[0], [1]])
    removeBlocks(root)
    expect(root.innerHTML).toBe('')
    // The normaliser is what puts somewhere to type back, as it does after any edit.
    normalize(root)
    expect(root.innerHTML).toBe('<p><br></p>')
  })
})

describe('the block selection', () => {
  it('addresses picked blocks by the same paths a move takes', () => {
    root.innerHTML = '<p>a</p><div class="callout"><p>b</p></div>'
    setPicked(root, [[1, 0], [0]])
    expect(pickedPaths(root)).toEqual([[0], [1, 0]])
  })

  it('travels with the block it marks, so a group stays picked after a move', () => {
    root.innerHTML = '<p>a</p><p>b</p><p>c</p>'
    setPicked(root, [[0], [1]])
    moveBlocks(root, { from: pickedPaths(root), to: [2], position: 'after' })
    expect(pickedPaths(root)).toEqual([[1], [2]])
  })

  it('reports whether the set changed, so a redraw is not asked for twice', () => {
    root.innerHTML = '<p>a</p><p>b</p>'
    expect(setPicked(root, [[0]])).toBe(true)
    expect(setPicked(root, [[0]])).toBe(false)
    expect(clearPicked(root)).toBe(true)
    expect(clearPicked(root)).toBe(false)
  })

  it('never reaches a file', () => {
    root.innerHTML = '<p>a</p>'
    setPicked(root, [[0]])
    expect(serializeFragment(root)).toBe('<p>a</p>')
  })
})

describe('a callout’s colour', () => {
  it('is written on the callout the caret stands in, however deep', () => {
    root.innerHTML = '<div class="callout"><ul><li>note</li></ul></div>'
    select(caret('.callout li', 2))
    styleBlock(root, { selector: '.callout', property: 'background-color', value: '#d9efe6' })

    const callout = root.querySelector<HTMLElement>('.callout')!
    expect(sameColor(callout.style.backgroundColor, '#d9efe6')).toBe(true)
  })

  it('comes back for the swatch to light up from', () => {
    root.innerHTML = '<div class="callout" style="background-color:#d9efe6"><p>note</p></div>'
    select(caret('.callout p', 1))

    const state = queryState(root)
    expect(state.callout).toBe(true)
    expect(sameColor(state.calloutColor, '#d9efe6')).toBe(true)
  })

  it('is nothing at all outside a callout', () => {
    root.innerHTML = '<p>plain</p>'
    select(caret('p', 1))
    expect(queryState(root).callout).toBe(false)
  })

  it('is not mistaken for a highlight on the text inside it', () => {
    root.innerHTML = '<div class="callout" style="background-color:#d9efe6"><p>note</p></div>'
    select(caret('.callout p', 1))
    // The Background swatch acts on the selected text, so it must not light up
    // for a colour the callout is wearing.
    expect(queryState(root).background).toBeNull()
  })

  it('leaves a real highlight on the text alone', () => {
    root.innerHTML =
      '<div class="callout" style="background-color:#d9efe6"><p><span style="background-color:#fbe4d5">note</span></p></div>'
    select(caret('.callout span', 1))
    expect(sameColor(queryState(root).background, '#fbe4d5')).toBe(true)
  })

  it('goes away again without leaving an empty attribute behind', () => {
    root.innerHTML = '<div class="callout" style="background-color:#d9efe6"><p>note</p></div>'
    select(caret('.callout p', 1))
    styleBlock(root, { selector: '.callout', property: 'background-color', value: null })
    expect(root.innerHTML).toBe('<div class="callout"><p>note</p></div>')
  })
})
