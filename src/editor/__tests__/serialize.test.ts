import { beforeEach, describe, expect, it } from 'vitest'
import { serializeFragment } from '../dom/serialize'
import { sanitizeHtml, htmlFromClipboard } from '../dom/sanitize'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  document.body.replaceChildren(root)
})

function print(html: string): string {
  root.innerHTML = html
  return serializeFragment(root)
}

describe('pretty-printer', () => {
  it('puts each block on its own line', () => {
    expect(print('<h1>Title</h1><p>Body</p>')).toBe('<h1>Title</h1>\n<p>Body</p>')
  })

  it('keeps inline content on the block’s line', () => {
    expect(print('<p>a <strong>b</strong> c</p>')).toBe('<p>a <strong>b</strong> c</p>')
  })

  it('indents nested blocks', () => {
    expect(print('<ul><li>one</li><li>two</li></ul>')).toBe(
      '<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>',
    )
  })

  it('indents deeply without losing structure', () => {
    expect(print('<ul><li>a<ul><li>b</li></ul></li></ul>')).toBe(
      '<ul>\n  <li>\n    a\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('writes void elements without a closing tag', () => {
    expect(print('<figure><img src="a.png" alt="x"></figure>')).toBe(
      '<figure>\n  <img src="a.png" alt="x">\n</figure>',
    )
    expect(print('<p>a<br>b</p>')).toBe('<p>a<br>b</p>')
  })

  it('never reformats inside pre', () => {
    expect(print('<pre><code>a\n  b\n</code></pre>')).toBe('<pre><code>a\n  b\n</code></pre>')
  })

  it('escapes text but not markup', () => {
    root.innerHTML = ''
    const p = document.createElement('p')
    p.textContent = 'a < b & c'
    root.append(p)
    expect(serializeFragment(root)).toBe('<p>a &lt; b &amp; c</p>')
  })

  it('escapes quotes in attribute values', () => {
    root.innerHTML = ''
    const p = document.createElement('p')
    p.setAttribute('title', 'a "quoted" value')
    p.textContent = 'x'
    root.append(p)
    expect(serializeFragment(root)).toBe('<p title="a &quot;quoted&quot; value">x</p>')
  })

  it('keeps a valueless attribute', () => {
    expect(print('<p><img src="a.png" alt=""></p>')).toBe('<p><img src="a.png" alt=""></p>')
  })

  it('round-trips its own output', () => {
    const source = '<h1>T</h1>\n<ul>\n  <li>one</li>\n  <li>two</li>\n</ul>\n<p>end</p>'
    expect(print(source)).toBe(source)
  })
})

describe('paste sanitisation', () => {
  it('strips scripts and event handlers', () => {
    expect(sanitizeHtml('<p onclick="steal()">x</p><script>bad()</script>')).toBe('<p>x</p>')
    expect(sanitizeHtml('<img src="x" onerror="bad()">')).toBe('<img src="x">')
  })

  it('strips javascript: urls', () => {
    expect(sanitizeHtml('<a href="javascript:bad()">x</a>')).not.toContain('javascript:')
  })

  it('stays permissive — arbitrary HTML is the product', () => {
    const rich = '<div class="grid" style="color:red" data-aprinote="pg_1"><p>kept</p></div>'
    expect(sanitizeHtml(rich)).toBe(rich)
  })

  it('keeps an iframe embed', () => {
    expect(sanitizeHtml('<iframe src="https://example.com"></iframe>')).toContain('<iframe')
  })

  it('keeps the text of a stripped wrapper', () => {
    expect(sanitizeHtml('<form><p>still here</p></form>')).toBe('<p>still here</p>')
  })
})

describe('clipboard', () => {
  const transfer = (types: Record<string, string>) =>
    ({ getData: (type: string) => types[type] ?? '' }) as DataTransfer

  it('prefers structured HTML', () => {
    expect(htmlFromClipboard(transfer({ 'text/html': '<p><b>hi</b></p>' }), document)).toBe(
      '<p><b>hi</b></p>',
    )
  })

  it('turns plain text into paragraphs at blank lines', () => {
    expect(htmlFromClipboard(transfer({ 'text/plain': 'one\n\ntwo' }), document)).toBe(
      '<p>one</p><p>two</p>',
    )
  })

  it('escapes plain text rather than trusting it', () => {
    expect(htmlFromClipboard(transfer({ 'text/plain': '<script>x</script>' }), document)).toBe(
      '<p>&lt;script&gt;x&lt;/script&gt;</p>',
    )
  })

  it('returns nothing for an empty clipboard', () => {
    expect(htmlFromClipboard(transfer({}), document)).toBe('')
  })
})
