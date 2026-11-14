import { beforeEach, describe, expect, it } from 'vitest'
import { toVaultPath } from '../assets/resolve'
import { serializeFragment } from '../dom/serialize'
import {
  columnCount,
  deleteColumn,
  deleteRow,
  hasHeaderRow,
  insertColumn,
  insertRow,
  rowsOf,
  toggleHeaderRow,
  toggleZebra,
} from '../table/ops'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  root.className = 'aprinote-page'
  document.body.replaceChildren(root)
})

describe('toVaultPath', () => {
  it('resolves a page-relative reference against the page', () => {
    expect(toVaultPath('handbook/guide.html', '../_assets/map.png')).toBe('_assets/map.png')
    expect(toVaultPath('index.html', '_assets/map.png')).toBe('_assets/map.png')
    expect(toVaultPath('a/b/deep.html', '../../_assets/map.png')).toBe('_assets/map.png')
  })

  it('leaves remote and inline references alone', () => {
    expect(toVaultPath('index.html', 'https://example.com/a.png')).toBeNull()
    expect(toVaultPath('index.html', 'data:image/png;base64,xxx')).toBeNull()
    expect(toVaultPath('index.html', 'blob:http://localhost/abc')).toBeNull()
    expect(toVaultPath('index.html', '')).toBeNull()
  })

  it('decodes escaped filenames', () => {
    expect(toVaultPath('index.html', '_assets/my%20map.png')).toBe('_assets/my map.png')
  })
})

describe('serializer and the blob swap', () => {
  /**
   * The canonical path lives in `data-aprinote-src` while a blob URL sits in `src`;
   * what reaches a file must be the canonical path, every time.
   */
  it('writes the canonical src back and drops the editor-only attribute', () => {
    root.innerHTML =
      '<figure><img src="blob:http://localhost/abc" data-aprinote-src="../_assets/map.png" alt="Map"></figure>'
    expect(serializeFragment(root)).toBe(
      '<figure>\n  <img src="../_assets/map.png" alt="Map">\n</figure>',
    )
  })

  it('keeps the path even when the bytes were missing', () => {
    root.innerHTML = '<figure><img data-aprinote-src="../_assets/gone.png" data-aprinote-missing=""></figure>'
    const out = serializeFragment(root)
    expect(out).toContain('src="../_assets/gone.png"')
    expect(out).not.toContain('data-aprinote-missing')
  })

  it('never leaks the selection marker into a file', () => {
    root.innerHTML = '<figure data-aprinote-selected=""><img src="a.png"></figure>'
    expect(serializeFragment(root)).not.toContain('data-aprinote-selected')
  })

  it('leaves an ordinary src untouched', () => {
    root.innerHTML = '<p><img src="https://example.com/a.png"></p>'
    expect(serializeFragment(root)).toBe('<p><img src="https://example.com/a.png"></p>')
  })
})

describe('table structure', () => {
  function table(html: string): HTMLTableElement {
    root.innerHTML = html
    return root.querySelector('table')!
  }

  const shape = (t: HTMLTableElement) =>
    rowsOf(t).map((row) => [...row.children].map((c) => `${c.tagName}:${c.textContent}`).join(','))

  it('counts rows and columns', () => {
    const t = table('<table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table>')
    expect(rowsOf(t)).toHaveLength(2)
    expect(columnCount(t)).toBe(2)
  })

  it('inserts a row at a position with the right number of cells', () => {
    const t = table('<table><tr><th>a</th><th>b</th></tr><tr><td>c</td><td>d</td></tr></table>')
    insertRow(t, 1)
    expect(shape(t)).toEqual(['TH:a,TH:b', 'TD:,TD:', 'TD:c,TD:d'])
  })

  it('appends a row past the end', () => {
    const t = table('<table><tr><td>a</td></tr></table>')
    insertRow(t, 5)
    expect(rowsOf(t)).toHaveLength(2)
  })

  it('inserts a column, matching each row’s cell type', () => {
    const t = table('<table><tr><th>a</th></tr><tr><td>b</td></tr></table>')
    insertColumn(t, 1)
    expect(shape(t)).toEqual(['TH:a,TH:', 'TD:b,TD:'])
  })

  it('deletes rows and columns, but never the last one', () => {
    const t = table('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')
    deleteRow(t, 0)
    expect(shape(t)).toEqual(['TD:c,TD:d'])
    deleteRow(t, 0)
    expect(shape(t)).toEqual(['TD:c,TD:d'])

    deleteColumn(t, 0)
    expect(shape(t)).toEqual(['TD:d'])
    deleteColumn(t, 0)
    expect(shape(t)).toEqual(['TD:d'])
  })

  it('promotes and demotes the header row, keeping the text', () => {
    const t = table('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>')
    expect(hasHeaderRow(t)).toBe(false)

    toggleHeaderRow(t)
    expect(hasHeaderRow(t)).toBe(true)
    expect(shape(t)).toEqual(['TH:a,TH:b', 'TD:c,TD:d'])

    toggleHeaderRow(t)
    expect(shape(t)).toEqual(['TD:a,TD:b', 'TD:c,TD:d'])
  })

  it('toggles zebra as a class the stylesheet renders', () => {
    const t = table('<table><tr><td>a</td></tr></table>')
    toggleZebra(t)
    expect(t.getAttribute('class')).toBe('zebra')
    toggleZebra(t)
    // No empty class attribute left behind for the serializer to write out.
    expect(t.hasAttribute('class')).toBe(false)
  })
})
