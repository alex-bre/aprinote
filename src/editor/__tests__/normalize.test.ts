import { beforeEach, describe, expect, it } from 'vitest'
import { normalize, normalizeFragment } from '../dom/normalize'

let root: HTMLElement

beforeEach(() => {
  root = document.createElement('article')
  document.body.append(root)
})

/** Normalise `html` and return the result without the guaranteed trailing paragraph. */
function run(html: string): string {
  root.innerHTML = html
  normalize(root)
  return root.innerHTML.replace(/<p><br><\/p>$/, '')
}

describe('deprecated tags', () => {
  it('rewrites presentational tags to semantic ones', () => {
    expect(run('<p><b>bold</b> and <i>italic</i></p>')).toBe(
      '<p><strong>bold</strong> and <em>italic</em></p>',
    )
    expect(run('<p><strike>gone</strike></p>')).toBe('<p><s>gone</s></p>')
  })

  it('strips font entirely but keeps its text', () => {
    expect(run('<p><font color="red">kept</font></p>')).toBe('<p>kept</p>')
    // <center> is block-level, so it cannot sit inside <p> — top level is the
    // only place the parser will actually leave it for us to unwrap.
    expect(run('<center>middle</center>')).toBe('<p>middle</p>')
  })

  it('carries attributes across a rename', () => {
    expect(run('<p><b class="x">t</b></p>')).toBe('<p><strong class="x">t</strong></p>')
  })
})

describe('inline hygiene', () => {
  it('drops empty inline wrappers', () => {
    // The empty <strong> goes and the text either side merges; the whitespace-only
    // <em> stays, because a space between words is content.
    expect(run('<p>a<strong></strong>b<em>  </em></p>')).toBe('<p>ab<em>  </em></p>')
    expect(run('<p><span></span>text</p>')).toBe('<p>text</p>')
  })

  it('keeps an inline wrapper that holds a line break or image', () => {
    expect(run('<p><span><br></span></p>')).toBe('<p><span><br></span></p>')
  })

  it('merges adjacent identical inlines', () => {
    expect(run('<p><strong>a</strong><strong>b</strong></p>')).toBe('<p><strong>ab</strong></p>')
    expect(run('<p><span style="color:red">a</span><span style="color:red">b</span></p>')).toBe(
      '<p><span style="color:red">ab</span></p>',
    )
  })

  it('leaves differing inlines alone', () => {
    expect(run('<p><span style="color:red">a</span><span style="color:blue">b</span></p>')).toBe(
      '<p><span style="color:red">a</span><span style="color:blue">b</span></p>',
    )
  })

  it('never merges two links — that would fuse two destinations', () => {
    expect(run('<p><a href="/a">one</a><a href="/a">two</a></p>')).toBe(
      '<p><a href="/a">one</a><a href="/a">two</a></p>',
    )
  })

  it('flattens a nested identical inline', () => {
    expect(run('<p><strong><strong>x</strong></strong></p>')).toBe('<p><strong>x</strong></p>')
  })

  it('removes attributes that are present but empty', () => {
    expect(run('<p style="">a</p>')).toBe('<p>a</p>')
    expect(run('<p class="  ">a</p>')).toBe('<p>a</p>')
  })
})

describe('block structure', () => {
  it('wraps bare text in a paragraph', () => {
    expect(run('loose text')).toBe('<p>loose text</p>')
    expect(run('<h2>H</h2>trailing')).toBe('<h2>H</h2><p>trailing</p>')
  })

  it('wraps a run of loose inlines into one paragraph', () => {
    expect(run('a<strong>b</strong>c')).toBe('<p>a<strong>b</strong>c</p>')
  })

  it('leaves real blocks alone', () => {
    expect(run('<h1>T</h1><ul><li>a</li></ul>')).toBe('<h1>T</h1><ul><li>a</li></ul>')
  })
})

describe('blocks nested in paragraphs', () => {
  /**
   * The parser refuses to nest a block inside `<p>` — it splits the tags instead —
   * so this shape only exists when built through the DOM. Which is precisely how
   * `execCommand('insertUnorderedList')` creates it.
   */
  function nested(inner: string, attrs: Record<string, string> = {}): string {
    const paragraph = document.createElement('p')
    for (const [name, value] of Object.entries(attrs)) paragraph.setAttribute(name, value)
    paragraph.innerHTML = inner.replace('<ul>', '<!--ul-->')

    const list = document.createElement('ul')
    list.innerHTML = '<li>item</li>'
    const marker = [...paragraph.childNodes].find((n) => n.nodeType === Node.COMMENT_NODE)
    if (marker) paragraph.replaceChild(list, marker)
    else paragraph.appendChild(list)

    root.replaceChildren(paragraph)
    normalize(root)
    return root.innerHTML.replace(/<p><br><\/p>$/, '')
  }

  it('lifts a list execCommand left inside a paragraph', () => {
    expect(nested('<ul>')).toBe('<ul><li>item</li></ul>')
  })

  it('keeps inline runs either side as their own paragraphs', () => {
    expect(nested('before<ul>after')).toBe('<p>before</p><ul><li>item</li></ul><p>after</p>')
  })

  it('carries the paragraph’s styling onto the pieces', () => {
    expect(nested('a<ul>', { style: 'text-align: center' })).toBe(
      '<p style="text-align: center">a</p><ul><li>item</li></ul>',
    )
  })

  it('leaves an ordinary paragraph alone', () => {
    expect(run('<p>just <strong>text</strong></p>')).toBe('<p>just <strong>text</strong></p>')
  })
})

describe('bare divs', () => {
  it('turns a div from the browser’s Enter into a paragraph', () => {
    expect(run('<div>typed</div>')).toBe('<p>typed</p>')
  })

  it('leaves a div that carries meaning alone', () => {
    expect(run('<div class="callout">note</div>')).toBe('<div class="callout">note</div>')
    expect(run('<div style="text-align: center">x</div>')).toBe(
      '<div style="text-align: center">x</div>',
    )
  })
})

describe('nested lists', () => {
  it('moves a sublist inside the item it hangs off', () => {
    expect(run('<ul><li>one</li><ul><li>two</li></ul></ul>')).toBe(
      '<ul><li>one<ul><li>two</li></ul></li></ul>',
    )
  })

  it('gives an orphan sublist an item of its own', () => {
    expect(run('<ul><ul><li>lonely</li></ul></ul>')).toBe(
      '<ul><li><ul><li>lonely</li></ul></li></ul>',
    )
  })

  it('leaves correctly nested lists alone', () => {
    const valid = '<ul><li>one<ul><li>two</li></ul></li></ul>'
    expect(run(valid)).toBe(valid)
  })
})

describe('trailing paragraph', () => {
  it('guarantees the caret can reach the end after an atom', () => {
    root.innerHTML = '<p>text</p><figure><img src="a.png"></figure>'
    normalize(root)
    expect(root.innerHTML.endsWith('<p><br></p>')).toBe(true)
  })

  it('does not stack more than one', () => {
    root.innerHTML = '<p>text</p><p></p>'
    normalize(root)
    expect(root.innerHTML).toBe('<p>text</p><p><br></p>')
  })

  it('gives an empty document somewhere to type', () => {
    root.innerHTML = ''
    normalize(root)
    expect(root.innerHTML).toBe('<p><br></p>')
  })

  it('fills every empty block so the caret can enter it', () => {
    // Without the <br> the browser gives these no height and they cannot be clicked.
    expect(run('<p>a</p><h2></h2>')).toBe('<p>a</p><h2><br></h2>')
    root.innerHTML = '<table><tr><td></td></tr></table>'
    normalize(root)
    expect(root.innerHTML).toContain('<td><br></td>')
  })
})

describe('idempotence', () => {
  const cases = [
    '<p><b>a</b><i>b</i></p>',
    '<h1>T</h1><font>x</font>loose<ul><li><span></span>item</li></ul>',
    '<p><strong>a</strong><strong>b</strong></p><figure><img src="x.png"></figure>',
    '<blockquote><p>quoted</p></blockquote>',
    '<ul><li>one</li><ul><li>two</li></ul></ul>',
  ]

  it.each(cases)('a second pass changes nothing: %s', (html) => {
    root.innerHTML = html
    normalize(root)
    const once = root.innerHTML
    const { changed } = normalize(root)
    expect(changed).toBe(false)
    expect(root.innerHTML).toBe(once)
  })
})

describe('normalizeFragment', () => {
  it('cleans detached markup without imposing block structure', () => {
    expect(normalizeFragment('<b>x</b>', document)).toBe('<strong>x</strong>')
    // No trailing paragraph — a pasted fragment is not a whole document.
    expect(normalizeFragment('<p>a</p>', document)).toBe('<p>a</p>')
  })
})
