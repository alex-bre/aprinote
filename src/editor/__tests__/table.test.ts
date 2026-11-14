import { beforeEach, describe, expect, it } from 'vitest'
import { commands } from '../EditorSurface'
import { registerCommands } from '../commands/index'
import { normalize } from '../dom/normalize'
import { serializeFragment } from '../dom/serialize'
import { pathOf, elementAt } from '../dom/structure'
import {
  alignColumn,
  columnAlign,
  columnWidths,
  deleteColumn,
  distributeColumns,
  duplicateColumn,
  duplicateRow,
  hasHeaderColumn,
  hasHeaderRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  rowsOf,
  setColumnWidths,
  toggleHeaderColumn,
  toggleHeaderRow,
} from '../table/ops'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  root.className = 'aprinote-page'
  document.body.replaceChildren(root)
})

function table(html: string): HTMLTableElement {
  root.innerHTML = html
  return root.querySelector('table')!
}

/** Every row as `TAG:text` cells — tag included, because the header ops move them. */
const shape = (t: HTMLTableElement) =>
  rowsOf(t).map((row) => [...row.children].map((c) => `${c.tagName}:${c.textContent}`).join(','))

const grid = (rows: string[][], header = false) =>
  `<table>${rows
    .map(
      (cells, r) =>
        `<tr>${cells.map((text) => `<${header && r === 0 ? 'th' : 'td'}>${text}</${header && r === 0 ? 'th' : 'td'}>`).join('')}</tr>`,
    )
    .join('')}</table>`

describe('moving rows and columns', () => {
  it('moves a row down to the index it was aimed at', () => {
    const t = table(grid([['a'], ['b'], ['c']]))
    moveRow(t, 0, 2)
    expect(shape(t)).toEqual(['TD:b', 'TD:c', 'TD:a'])
  })

  it('moves a row up to the index it was aimed at', () => {
    const t = table(grid([['a'], ['b'], ['c']]))
    moveRow(t, 2, 0)
    expect(shape(t)).toEqual(['TD:c', 'TD:a', 'TD:b'])
  })

  it('leaves a header row where it is, in either direction', () => {
    const t = table(grid([['h'], ['a'], ['b']], true))
    moveRow(t, 0, 2)
    moveRow(t, 2, 0)
    expect(shape(t)).toEqual(['TH:h', 'TD:a', 'TD:b'])
  })

  it('moves a column in every row at once', () => {
    const t = table(grid([['a', 'b', 'c'], ['d', 'e', 'f']]))
    moveColumn(t, 0, 2)
    expect(shape(t)).toEqual(['TD:b,TD:c,TD:a', 'TD:e,TD:f,TD:d'])

    moveColumn(t, 2, 1)
    expect(shape(t)).toEqual(['TD:b,TD:a,TD:c', 'TD:e,TD:d,TD:f'])
  })

  it('keeps the header cells with the first column when it moves', () => {
    const t = table('<table><tr><th>a</th><td>b</td></tr><tr><th>c</th><td>d</td></tr></table>')
    expect(hasHeaderColumn(t)).toBe(true)
    moveColumn(t, 0, 1)
    expect(shape(t)).toEqual(['TH:b,TD:a', 'TH:d,TD:c'])
  })
})

describe('duplicating rows and columns', () => {
  it('copies a row below itself, cell text and all', () => {
    const t = table(grid([['a', 'b'], ['c', 'd']]))
    duplicateRow(t, 1)
    expect(shape(t)).toEqual(['TD:a,TD:b', 'TD:c,TD:d', 'TD:c,TD:d'])
  })

  it('makes the copy of a header row an ordinary one — one header is the point', () => {
    const t = table(grid([['h1', 'h2'], ['a', 'b']], true))
    duplicateRow(t, 0)
    expect(shape(t)).toEqual(['TH:h1,TH:h2', 'TD:h1,TD:h2', 'TD:a,TD:b'])
  })

  it('copies a column to its right', () => {
    const t = table(grid([['a', 'b'], ['c', 'd']]))
    duplicateColumn(t, 0)
    expect(shape(t)).toEqual(['TD:a,TD:a,TD:b', 'TD:c,TD:c,TD:d'])
  })
})

describe('header rows and header columns', () => {
  it('adds a header column without disturbing the header row', () => {
    const t = table(grid([['h1', 'h2'], ['a', 'b'], ['c', 'd']], true))
    toggleHeaderColumn(t)
    expect(shape(t)).toEqual(['TH:h1,TH:h2', 'TH:a,TD:b', 'TH:c,TD:d'])
    expect(hasHeaderRow(t)).toBe(true)
    expect(hasHeaderColumn(t)).toBe(true)

    toggleHeaderColumn(t)
    expect(shape(t)).toEqual(['TH:h1,TH:h2', 'TD:a,TD:b', 'TD:c,TD:d'])
  })

  it('demotes a header row while a header column stays a header column', () => {
    const t = table('<table><tr><th>h1</th><th>h2</th></tr><tr><th>a</th><td>b</td></tr></table>')
    toggleHeaderRow(t)
    expect(shape(t)).toEqual(['TH:h1,TD:h2', 'TH:a,TD:b'])
    expect(hasHeaderRow(t)).toBe(false)
    expect(hasHeaderColumn(t)).toBe(true)
  })

  it('gives a new row a header cell when the table has a header column', () => {
    const t = table('<table><tr><th>a</th><td>b</td></tr></table>')
    insertRow(t, 1)
    expect(shape(t)).toEqual(['TH:a,TD:b', 'TH:,TD:'])
  })

  it('gives a new column body cells, even beside a header row', () => {
    const t = table(grid([['h'], ['a']], true))
    insertColumn(t, 1)
    expect(shape(t)).toEqual(['TH:h,TH:', 'TD:a,TD:'])
  })

  it('hands the header cells on when a column is inserted before them', () => {
    const t = table('<table><tr><th>a</th><td>b</td></tr></table>')
    insertColumn(t, 0)
    expect(shape(t)).toEqual(['TH:,TD:a,TD:b'])
  })

  it('keeps a header row whole when its first column is deleted', () => {
    const t = table(grid([['h1', 'h2'], ['a', 'b']], true))
    deleteColumn(t, 0)
    expect(shape(t)).toEqual(['TH:h2', 'TD:b'])
  })
})

describe('column alignment', () => {
  it('aligns one column and reads it back', () => {
    const t = table(grid([['a', 'b'], ['c', 'd']]))
    alignColumn(t, 1, 'right')
    expect(columnAlign(t, 1)).toBe('right')
    expect(columnAlign(t, 0)).toBe('left')
    expect(t.querySelectorAll('[style]')).toHaveLength(2)
  })

  it('clears the property rather than writing left', () => {
    const t = table(grid([['a'], ['b']]))
    alignColumn(t, 0, 'center')
    alignColumn(t, 0, 'left')
    // No empty style attribute left behind for the serializer to write out.
    expect(t.querySelectorAll('[style]')).toHaveLength(0)
  })
})

describe('column widths', () => {
  it('writes a colgroup of percentages that always sums to a hundred', () => {
    const t = table(grid([['a', 'b']]))
    setColumnWidths(t, [0.25, 0.75])
    expect([...t.querySelectorAll('col')].map((c) => c.style.width)).toEqual(['25%', '75%'])
    expect(t.style.tableLayout).toBe('fixed')
    expect(columnWidths(t)).toEqual([0.25, 0.75])
  })

  it('normalises widths that do not sum to one', () => {
    const t = table(grid([['a', 'b']]))
    setColumnWidths(t, [1, 3])
    expect(columnWidths(t)).toEqual([0.25, 0.75])
  })

  it('reads widths a hand-written file declared as attributes', () => {
    const t = table('<table><colgroup><col width="30%"><col width="70%"></colgroup><tr><td>a</td><td>b</td></tr></table>')
    expect(columnWidths(t)).toEqual([0.3, 0.7])
  })

  it('keeps the colgroup in step when a column is inserted or deleted', () => {
    const t = table(grid([['a', 'b']]))
    setColumnWidths(t, [0.5, 0.5])

    insertColumn(t, 2)
    expect(columnWidths(t)).toHaveLength(3)
    expect(columnWidths(t)!.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1)

    deleteColumn(t, 0)
    expect(columnWidths(t)).toHaveLength(2)
    expect(columnWidths(t)!.reduce((sum, w) => sum + w, 0)).toBeCloseTo(1)
  })

  it('carries a column’s width with it when the column moves', () => {
    const t = table(grid([['a', 'b', 'c']]))
    setColumnWidths(t, [0.2, 0.3, 0.5])
    moveColumn(t, 0, 2)
    expect(columnWidths(t)).toEqual([0.3, 0.5, 0.2])
  })

  it('leaves nothing behind when the widths are distributed again', () => {
    const t = table(grid([['a', 'b']]))
    setColumnWidths(t, [0.25, 0.75])
    distributeColumns(t)
    expect(columnWidths(t)).toBeNull()
    expect(t.hasAttribute('style')).toBe(false)
    expect(t.querySelector('colgroup')).toBeNull()
  })

  it('survives the normaliser and the serializer as ordinary HTML', () => {
    const t = table(grid([['a', 'b']]))
    setColumnWidths(t, [0.4, 0.6])
    normalize(root)

    const html = serializeFragment(root)
    expect(html).toContain('<colgroup>')
    expect(html).toContain('<col style="width: 40%;">')
    expect(root.querySelector('colgroup')).not.toBeNull()
  })
})

describe('the commands the chrome and the inspector share', () => {
  /** Run a registered command against a table addressed by path. */
  function exec(command: string, args: Record<string, unknown> = {}) {
    registerCommands()
    const t = root.querySelector('table')!
    commands.get(command)!(root, { path: pathOf(root, t), ...args })
    return t
  }

  it('acts on the table it is given, wherever the caret is', () => {
    root.innerHTML = `<p>one</p>${grid([['a', 'b'], ['c', 'd']])}`
    expect(shape(exec('table.appendRow'))).toEqual(['TD:a,TD:b', 'TD:c,TD:d', 'TD:,TD:'])
    expect(shape(exec('table.appendColumn'))).toEqual([
      'TD:a,TD:b,TD:',
      'TD:c,TD:d,TD:',
      'TD:,TD:,TD:',
    ])
  })

  it('grows by a row and a column together, for the corner +', () => {
    root.innerHTML = grid([['a']])
    expect(shape(exec('table.appendRowAndColumn'))).toEqual(['TD:a,TD:', 'TD:,TD:'])
  })

  it('puts no row above a header row, however it is asked', () => {
    root.innerHTML = grid([['h'], ['a']], true)
    expect(shape(exec('table.insertRowAbove', { row: 0 }))).toEqual(['TH:h', 'TD:', 'TD:a'])
  })

  it('falls back to the first cell when the caret is somewhere else entirely', () => {
    root.innerHTML = `<p>one</p>${grid([['a', 'b'], ['c', 'd']])}`
    expect(shape(exec('table.insertColumnBefore'))).toEqual(['TD:,TD:a,TD:b', 'TD:,TD:c,TD:d'])
  })

  it('leaves a paragraph behind for the caret when the table goes', () => {
    root.innerHTML = `<p>one</p>${grid([['a']])}<p>two</p>`
    exec('table.delete')
    expect(root.querySelector('table')).toBeNull()
    expect(root.innerHTML).toBe('<p>one</p><p>two</p>')
  })
})

describe('addressing a table by path', () => {
  it('round-trips through pathOf and elementAt, callouts included', () => {
    root.innerHTML = `<p>one</p><div class="callout">${grid([['a']])}</div>`
    const t = root.querySelector('table')!
    const path = pathOf(root, t)
    expect(path).toEqual([1, 0])
    expect(elementAt(root, path)).toBe(t)
  })
})
