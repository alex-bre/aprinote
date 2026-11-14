/**
 * The pretty-printer: live DOM → readable HTML. This is what lands on disk and
 * what the source pane shows, so it optimises for a human reading a diff, not for
 * byte count.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])

/** Containers: always one tag per line, children indented, however simple. */
const CONTAINER = new Set([
  'article', 'aside', 'blockquote', 'colgroup', 'details', 'div', 'dl', 'fieldset',
  'figure', 'footer', 'form', 'header', 'main', 'menu', 'nav', 'ol', 'picture',
  'section', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
])

/** Text blocks: kept on one line when they hold nothing but inline content. */
const TEXT_BLOCK = new Set([
  'address', 'caption', 'dd', 'dt', 'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'legend', 'li', 'p', 'pre', 'summary', 'td', 'th',
])

const BLOCK = new Set([...CONTAINER, ...TEXT_BLOCK])

/** Whitespace inside these is content — never touch it. */
const PRESERVE = new Set(['pre', 'textarea', 'script', 'style'])

const INDENT = '  '

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Attributes that exist only while editing and must not reach a file. */
const CANONICAL_SRC = 'data-aprinote-src'
const EDITOR_ONLY = new Set([
  CANONICAL_SRC,
  'data-aprinote-missing',
  'data-aprinote-selected',
  'data-aprinote-picked',
  'data-aprinote-embed',
  'data-aprinote-broken',
  'contenteditable',
])

function openTag(element: Element): string {
  // `src` holds a blob URL while editing; the canonical path lives alongside it.
  const canonical = element.getAttribute(CANONICAL_SRC)

  const attrs = [...element.attributes]
    .filter((attr) => !EDITOR_ONLY.has(attr.name))
    .map((attr) => {
      const value = attr.name === 'src' && canonical !== null ? canonical : attr.value
      return value === '' ? ` ${attr.name}=""` : ` ${attr.name}="${escapeAttribute(value)}"`
    })

  // A reference whose bytes were missing has no src left to carry the path.
  if (canonical !== null && !element.hasAttribute('src')) {
    attrs.push(` src="${escapeAttribute(canonical)}"`)
  }
  return `<${element.tagName.toLowerCase()}${attrs.join('')}>`
}

/** True when the element holds only inline content and can stay on one line. */
function isInlineOnly(element: Element): boolean {
  return [...element.childNodes].every(
    (child) =>
      child.nodeType === Node.TEXT_NODE ||
      (child.nodeType === Node.ELEMENT_NODE && !BLOCK.has((child as Element).tagName.toLowerCase())),
  )
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeText(node.nodeValue ?? '')
  if (node.nodeType === Node.COMMENT_NODE) return `<!--${node.nodeValue ?? ''}-->`
  if (node.nodeType !== Node.ELEMENT_NODE) return ''

  const element = node as Element
  const tag = element.tagName.toLowerCase()
  if (VOID.has(tag)) return openTag(element)

  const inner = PRESERVE.has(tag)
    ? (element.innerHTML ?? '')
    : [...element.childNodes].map(serializeInline).join('')
  return `${openTag(element)}${inner}</${tag}>`
}

function serializeNode(node: Node, depth: number, out: string[]): void {
  const pad = INDENT.repeat(depth)

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.nodeValue ?? ''
    if (text.trim()) out.push(pad + escapeText(text.trim()))
    return
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    out.push(`${pad}<!--${node.nodeValue ?? ''}-->`)
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as Element
  const tag = element.tagName.toLowerCase()

  if (VOID.has(tag)) {
    out.push(pad + openTag(element))
    return
  }

  if (PRESERVE.has(tag)) {
    out.push(`${pad}${openTag(element)}${element.innerHTML}</${tag}>`)
    return
  }

  if (!CONTAINER.has(tag) && isInlineOnly(element)) {
    const inner = [...element.childNodes].map(serializeInline).join('')
    out.push(`${pad}${openTag(element)}${inner.trim()}</${tag}>`)
    return
  }

  out.push(pad + openTag(element))
  for (const child of element.childNodes) serializeNode(child, depth + 1, out)
  out.push(`${pad}</${tag}>`)
}

/** Pretty-print the children of `root` — the fragment, not the host element. */
export function serializeFragment(root: HTMLElement): string {
  const out: string[] = []
  for (const child of root.childNodes) serializeNode(child, 0, out)
  return out.join('\n')
}
