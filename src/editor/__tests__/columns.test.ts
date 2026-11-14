import { beforeEach, describe, expect, it } from 'vitest'
import { insertColumns, moveBlock, setColumns } from '../commands/blocks'
import { queryState } from '../commands/state'
import { normalize } from '../dom/normalize'

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

/** Put the caret at an offset inside the first text node of `selector`. */
function select(selector: string, offset = 0): void {
  const host = root.querySelector(selector)!
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  range.setStart(walker.nextNode() ?? host, offset)
  range.collapse(true)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

/** Run a command the way the surface does: the command, then the normaliser. */
function exec(command: (root: HTMLElement, args?: unknown) => void, args?: unknown): string {
  command(root, args)
  normalize(root)
  return root.innerHTML.replace(/<p><br><\/p>$/, '')
}

const two = '<div class="columns"><div class="column"><p>a</p></div><div class="column"><p>b</p></div></div>'

describe('column structure', () => {
  it('leaves a well-formed layout exactly as written', () => {
    expect(run(two)).toBe(two)
  })

  it('makes a block dropped between columns a column of its own', () => {
    expect(
      run('<div class="columns"><div class="column"><p>a</p></div><p>new</p><div class="column"><p>b</p></div></div>'),
    ).toBe(
      '<div class="columns"><div class="column"><p>a</p></div><div class="column"><p>new</p></div><div class="column"><p>b</p></div></div>',
    )
  })

  it('gives an emptied column a paragraph to click into', () => {
    expect(run('<div class="columns"><div class="column"></div><div class="column"><p>b</p></div></div>')).toBe(
      '<div class="columns"><div class="column"><p><br></p></div><div class="column"><p>b</p></div></div>',
    )
  })

  it('removes a layout with no columns left', () => {
    expect(run('<div class="columns"></div><p>after</p>')).toBe('<p>after</p>')
  })
})

describe('inserting columns', () => {
  it('turns the line the caret is on into the first column', () => {
    root.innerHTML = '<p>intro</p>'
    select('p', 2)
    expect(exec(insertColumns, 2)).toBe(
      '<div class="columns"><div class="column"><p>intro</p></div><div class="column"><p><br></p></div></div>',
    )
  })

  it('never nests a layout inside a column', () => {
    root.innerHTML = two
    select('.column p', 1)
    insertColumns(root, 3)
    expect(root.querySelectorAll('.columns .columns')).toHaveLength(0)
    expect(root.querySelectorAll('.columns')).toHaveLength(2)
    expect(root.children[1].children).toHaveLength(3)
  })
})

describe('changing the column count', () => {
  it('adds empty columns at the end', () => {
    root.innerHTML = two
    select('.column p', 1)
    expect(exec(setColumns, 3)).toBe(
      '<div class="columns"><div class="column"><p>a</p></div><div class="column"><p>b</p></div><div class="column"><p><br></p></div></div>',
    )
    expect(queryState(root).columns).toBe(3)
  })

  it('hands the blocks of removed columns to the last one kept', () => {
    root.innerHTML =
      '<div class="columns"><div class="column"><p>a</p></div><div class="column"><p>b</p></div><div class="column"><p>c</p></div></div>'
    select('.column p', 1)
    expect(exec(setColumns, 2)).toBe(
      '<div class="columns"><div class="column"><p>a</p></div><div class="column"><p>b</p><p>c</p></div></div>',
    )
  })

  it('dissolves the layout at one column, keeping every block in order', () => {
    root.innerHTML = two
    select('.column p', 1)
    expect(exec(setColumns, 1)).toBe('<p>a</p><p>b</p>')
    expect(queryState(root).columns).toBe(0)
  })
})

describe('dragging columns', () => {
  it('reorders columns within their layout', () => {
    root.innerHTML = two
    moveBlock(root, { from: [0, 1], to: [0, 0], position: 'before' })
    normalize(root)
    expect(root.querySelector('.columns')!.textContent).toBe('ba')
  })

  it('leaves the blocks, not a stray column, when one is dragged out', () => {
    root.innerHTML = `${two}<p>end</p>`
    moveBlock(root, { from: [0, 1], to: [1], position: 'after' })
    expect(exec(() => {})).toBe(
      '<div class="columns"><div class="column"><p>a</p></div></div><p>end</p><p>b</p>',
    )
  })
})
