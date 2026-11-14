import { ATOM_TAGS, BLOCK_TAGS, emptyParagraph, inBlockForm, isContainer } from './structure'

/**
 * The normaliser.
 *
 * Runs after every mutation to canonicalise whatever the browser produced. This is
 * what keeps browser-generated markup from leaking into the user's files, and it
 * is the piece most worth unit-testing — it replaces the round-trip corpus a
 * schema-based editor would need.
 */

/** Deprecated presentational tags and what they become. */
const RENAME: Record<string, string> = {
  B: 'strong',
  I: 'em',
  STRIKE: 's',
  DEL: 's',
  BIG: 'span',
  TT: 'code',
}

/** Unwrapped entirely — the tag goes, its children stay. */
const UNWRAP = new Set(['FONT', 'CENTER', 'MARQUEE', 'BLINK', 'ACRONYM'])

const INLINE = new Set(['SPAN', 'STRONG', 'EM', 'U', 'S', 'CODE', 'SUB', 'SUP', 'A', 'MARK'])

function rename(element: Element, tag: string): Element {
  const replacement = element.ownerDocument.createElement(tag)
  for (const attr of [...element.attributes]) replacement.setAttribute(attr.name, attr.value)
  while (element.firstChild) replacement.appendChild(element.firstChild)
  element.replaceWith(replacement)
  return replacement
}

function unwrap(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  element.remove()
}

/** Two inline elements are mergeable when tag and every attribute match. */
function alike(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName || !INLINE.has(a.tagName)) return false
  if (a.tagName === 'A') return false // merging links would fuse two destinations
  if (a.attributes.length !== b.attributes.length) return false
  return [...a.attributes].every((attr) => b.getAttribute(attr.name) === attr.value)
}

function isEmptyInline(element: Element): boolean {
  if (!INLINE.has(element.tagName)) return false
  if (element.querySelector('img, br, iframe')) return false
  return element.textContent === ''
}

export interface NormalizeResult {
  changed: boolean
}

/**
 * Canonicalise `root` in place. Idempotent: running it twice on the same tree
 * makes no further changes, which is what the test suite pins.
 */
export function normalize(root: HTMLElement): NormalizeResult {
  const before = root.innerHTML

  renameDeprecated(root)
  dropEmptyInlines(root)
  flattenNestedInlines(root)
  mergeAdjacentInlines(root)
  stripEmptyAttributes(root)
  paragraphiseBareDivs(root)
  reparentSublists(root)
  unnestBlocks(root)
  ensureColumnStructure(root)
  ensureBlockStructure(root)
  ensureContainerStructure(root)
  ensureTrailingParagraph(root)
  ensureCaretTargets(root)

  return { changed: root.innerHTML !== before }
}

function renameDeprecated(root: HTMLElement): void {
  // Snapshot first: renaming replaces nodes, which would disturb a live walk.
  for (const element of [...root.querySelectorAll('*')]) {
    if (!root.contains(element)) continue
    if (UNWRAP.has(element.tagName)) {
      unwrap(element)
      continue
    }
    const tag = RENAME[element.tagName]
    if (tag) rename(element, tag)
  }
}

function dropEmptyInlines(root: HTMLElement): void {
  // Innermost first, so emptying a child can empty its parent in the same pass.
  let pass = 0
  for (; pass < 8; pass++) {
    const empties = [...root.querySelectorAll('*')].filter(isEmptyInline)
    if (empties.length === 0) break
    for (const element of empties) element.remove()
  }
}

/** `<strong><strong>x</strong></strong>` is just `<strong>x</strong>`. */
function flattenNestedInlines(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll('*')]) {
    if (!root.contains(element) || !INLINE.has(element.tagName) || element.tagName === 'A') continue
    const parent = element.parentElement
    if (parent && parent !== root && alike(parent, element)) unwrap(element)
  }
}

function mergeAdjacentInlines(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll('*')]) {
    if (!root.contains(element)) continue
    let next = element.nextSibling
    while (next && next.nodeType === Node.ELEMENT_NODE && alike(element, next as Element)) {
      const sibling = next as Element
      while (sibling.firstChild) element.appendChild(sibling.firstChild)
      next = sibling.nextSibling
      sibling.remove()
    }
  }
  root.normalize() // merge the text nodes the moves left adjacent
}

function stripEmptyAttributes(root: HTMLElement): void {
  for (const element of root.querySelectorAll('[style], [class]')) {
    if (element.getAttribute('style')?.trim() === '') element.removeAttribute('style')
    if (element.getAttribute('class')?.trim() === '') element.removeAttribute('class')
  }
}

/**
 * Chromium's Enter emits a bare `<div>` where a paragraph belongs. A `<div>`
 * carrying attributes is deliberate — `<div class="callout">` is a real block —
 * so only the naked ones are converted.
 */
function paragraphiseBareDivs(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll('div')]) {
    if (!root.contains(element) || element.attributes.length > 0) continue
    rename(element, 'p')
  }
}

/**
 * A nested list belongs *inside* the item it hangs off, not beside it.
 * `execCommand('indent')` emits `<ul><li>a</li><ul>…</ul></ul>`, which browsers
 * render but which is invalid — and these are real files people will open.
 */
function reparentSublists(root: HTMLElement): void {
  for (const list of [...root.querySelectorAll('ul, ol')]) {
    if (!root.contains(list)) continue
    const parent = list.parentElement
    if (!parent || (parent.tagName !== 'UL' && parent.tagName !== 'OL')) continue

    const previous = list.previousElementSibling
    if (previous?.tagName === 'LI') {
      previous.appendChild(list)
    } else {
      // No item to hang off — give it one rather than dropping the content.
      const item = root.ownerDocument.createElement('li')
      list.replaceWith(item)
      item.appendChild(list)
    }
  }
}

/**
 * A paragraph may not contain a block. `execCommand('insertUnorderedList')` emits
 * `<p><ul>…</ul></p>`, and paste produces the same shape, so lift the blocks out
 * and keep any inline runs either side as their own paragraphs.
 */
function unnestBlocks(root: HTMLElement): void {
  for (const paragraph of [...root.querySelectorAll('p')]) {
    if (!root.contains(paragraph)) continue
    if (![...paragraph.children].some((child) => BLOCK_TAGS.has(child.tagName))) continue

    const doc = root.ownerDocument
    const pieces: Node[] = []
    let run: Node[] = []

    const flushRun = () => {
      if (run.length === 0) return
      if (run.every((node) => !node.textContent?.trim() && node.nodeName !== 'BR')) {
        run = []
        return
      }
      const wrapper = doc.createElement('p')
      // Keep the original's own styling — text-align, most often.
      for (const attr of [...paragraph.attributes]) wrapper.setAttribute(attr.name, attr.value)
      for (const node of run) wrapper.appendChild(node)
      pieces.push(wrapper)
      run = []
    }

    for (const child of [...paragraph.childNodes]) {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
        flushRun()
        pieces.push(child)
      } else {
        run.push(child)
      }
    }
    flushRun()

    paragraph.replaceWith(...pieces)
  }
}

/**
 * Bare text directly under the article gets wrapped in a paragraph — browsers
 * produce it on paste and on backspace, and it has no home in the document format.
 * Runs over a callout too, which holds blocks by exactly the same rule.
 */
function ensureBlockStructure(host: HTMLElement): void {
  const root = host
  let loose: Node[] = []

  const flush = () => {
    if (loose.length === 0) return
    const paragraph = root.ownerDocument.createElement('p')
    root.insertBefore(paragraph, loose[0])
    for (const node of loose) paragraph.appendChild(node)
    loose = []
  }

  for (const node of [...root.childNodes]) {
    const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)
    if (isBlock) flush()
    else if (node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim()) continue
    else loose.push(node)
  }
  flush()
}

/**
 * A column layout holds columns and nothing else, so whatever lands between them
 * — a block dropped from the gutter, a paste — becomes a column of its own, next
 * to the one it was aimed beside. A column emptied of everything gets a paragraph
 * back, so it stays a column you can click into; a layout left with no columns at
 * all is gone.
 *
 * Keyed on the `columns` class this editor writes, the way callouts are, so a
 * `<div>` of the user's own is never reorganised.
 */
function ensureColumnStructure(root: HTMLElement): void {
  const doc = root.ownerDocument
  const isColumnElement = (node: Node): node is HTMLElement =>
    isContainer(node) && node.classList.contains('column')

  for (const layout of [...root.querySelectorAll<HTMLElement>('.columns')]) {
    if (!root.contains(layout) || !isContainer(layout)) continue

    // Consecutive strays share one new column, so a group dropped together stays together.
    let stray: HTMLElement | null = null
    for (const node of [...layout.childNodes]) {
      if (isColumnElement(node)) {
        stray = null
        continue
      }
      if (node.nodeType === Node.TEXT_NODE && !node.nodeValue?.trim()) continue
      if (node.nodeName === 'BR') {
        node.remove()
        continue
      }
      if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) continue
      if (!stray) {
        stray = doc.createElement('div')
        stray.className = 'column'
        layout.insertBefore(stray, node)
      }
      stray.appendChild(node)
    }

    const columns = [...layout.children].filter(isColumnElement)
    if (columns.length === 0) {
      layout.remove()
      continue
    }
    for (const column of columns) {
      if (!column.textContent?.trim() && !column.querySelector(':not(br)')) {
        column.replaceChildren(emptyParagraph(doc))
      }
    }
  }
}

/**
 * A callout holding blocks is an article in miniature: loose text between them
 * needs a paragraph, and an image at the end needs somewhere to type after it.
 *
 * A callout holding nothing but inline content is left exactly as written —
 * `<div class="callout">note</div>` is the common shape in real files, and
 * rewriting it on open would churn every document that has one.
 */
function ensureContainerStructure(root: HTMLElement): void {
  for (const container of root.querySelectorAll<HTMLElement>('div, aside, section')) {
    if (!root.contains(container)) continue
    if (!inBlockForm(container)) continue
    ensureBlockStructure(container)

    const last = container.lastElementChild
    if (last && ATOM_TAGS.has(last.tagName)) {
      container.appendChild(root.ownerDocument.createElement('p'))
    }
  }
}

/**
 * A trailing empty paragraph guarantees the caret can always reach the end of the
 * document — without it, a page ending in an image or table traps the caret.
 */
function ensureTrailingParagraph(root: HTMLElement): void {
  const last = root.lastElementChild
  if (last && last.tagName === 'P' && last.textContent === '') return
  if (!last || ATOM_TAGS.has(last.tagName) || BLOCK_TAGS.has(last.tagName)) {
    root.appendChild(root.ownerDocument.createElement('p'))
  }
}

/** Blocks that must stay clickable even when they hold no text. */
const CARET_TARGET = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE'])

/**
 * An empty block needs a `<br>` or the browser gives it no height and the caret
 * cannot be placed in it — which would make the guaranteed trailing paragraph
 * above useless, and an empty table cell impossible to type in. Every
 * contenteditable editor writes this filler for the same reason.
 */
function ensureCaretTargets(root: HTMLElement): void {
  for (const element of root.querySelectorAll([...CARET_TARGET].join(','))) {
    if (element.childNodes.length === 0) {
      element.appendChild(root.ownerDocument.createElement('br'))
    }
  }
  // An emptied callout is a block with no blocks in it — same problem, and the
  // `<br>` keeps it clickable until something is typed into it.
  for (const container of root.querySelectorAll<HTMLElement>('div, aside, section')) {
    if (isContainer(container) && container.childNodes.length === 0) {
      container.appendChild(root.ownerDocument.createElement('br'))
    }
  }
}

/** Normalise a detached fragment — used by paste, before anything is inserted. */
export function normalizeFragment(html: string, doc: Document): string {
  const host = doc.createElement('div')
  host.innerHTML = html
  renameDeprecated(host)
  dropEmptyInlines(host)
  flattenNestedInlines(host)
  mergeAdjacentInlines(host)
  stripEmptyAttributes(host)
  return host.innerHTML
}
