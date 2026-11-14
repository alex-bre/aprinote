/**
 * Vault and page CSS.
 *
 * `_vault/site.css` is editable in the app, which means WYSIWYG has to *render
 * under it* — otherwise editing and reading disagree and the whole premise leaks.
 *
 * The problem: site.css is written for a standalone page, so it contains rules
 * like `body{…}` and `h1{…}` that would bleed straight into the app's own chrome
 * if injected globally. Preview is safe (it's an iframe); the editor surface is
 * not. The fix is `@scope (.aprinote-page)`.
 *
 * One wrinkle: inside `@scope`, a bare `body`
 * selector matches a *descendant* `body` element, of which there are none — so a
 * `body{}` rule would silently do nothing. Root-ish selectors are therefore
 * rewritten to `:scope`, which is the scoping root itself. That is a targeted
 * rewrite of three selector heads, not the full selector prefixing of option 2.
 */

export const EDITOR_SCOPE = '.aprinote-page'

const COMMENT = /\/\*[\s\S]*?\*\//g

/** Rewrite `html`, `body` and `:root` selector heads to `:scope`. */
export function rewriteRootSelectors(selectorList: string): string {
  const parts = selectorList.split(',').map((part) => {
    let selector = part.trim()
    if (!selector) return selector
    selector = selector.replace(/^html\b\s*>?\s*/i, '')
    selector = selector.replace(/^:root\b/i, ':scope')
    selector = selector.replace(/^body\b/i, ':scope')
    return selector === '' ? ':scope' : selector
  })

  const seen = new Set<string>()
  const unique = parts.filter((part) => part && !seen.has(part) && seen.add(part))
  return unique.join(', ')
}

/**
 * Walk the stylesheet rewriting selector heads. Tracks braces so declarations are
 * copied through untouched and at-rule preludes (`@media`, `@supports`) are left
 * alone while the rules inside them are still rewritten.
 */
function rewriteSelectors(css: string): string {
  let out = ''
  let buffer = ''
  let depth = 0
  /** Depths whose contents are declarations, not nested rules. */
  let declarationDepth = -1

  for (const char of css) {
    if (char === '{') {
      const prelude = buffer
      const isAtRule = prelude.trim().startsWith('@')
      const inDeclarations = declarationDepth !== -1

      out += (isAtRule || inDeclarations ? prelude : ` ${rewriteRootSelectors(prelude)} `) + '{'
      buffer = ''
      depth++
      // An at-rule prelude opens a nested block of rules; anything else opens
      // declarations, where the next `{` would belong to CSS nesting.
      if (!isAtRule && declarationDepth === -1) declarationDepth = depth
    } else if (char === '}') {
      out += buffer + '}'
      buffer = ''
      if (declarationDepth === depth) declarationDepth = -1
      depth--
    } else {
      buffer += char
    }
  }
  return out + buffer
}

/**
 * Wrap a standalone stylesheet so it applies only inside the editor host.
 * Returns '' for empty input so nothing is injected for a vault without CSS.
 */
export function scopeCss(css: string, scope = EDITOR_SCOPE): string {
  const source = css.replace(COMMENT, '').trim()
  if (!source) return ''
  return `@scope (${scope}) {\n${rewriteSelectors(source)}\n}`
}

const SITE_STYLE_ID = 'aprinote-site-css'
const PAGE_STYLE_ID = 'aprinote-page-css'

function styleElement(doc: Document, id: string): HTMLStyleElement {
  const existing = doc.getElementById(id)
  if (existing) return existing as HTMLStyleElement

  const element = doc.createElement('style')
  element.id = id
  doc.head.appendChild(element)
  return element
}

/**
 * Inject the vault stylesheet and the open page's own `<style>` blocks, page rules
 * last so they win. Applied on save rather than as you type, so a
 * half-written selector never repaints the document mid-keystroke.
 */
export function injectCss(doc: Document, siteCss: string, pageCss: string): void {
  styleElement(doc, SITE_STYLE_ID).textContent = scopeCss(siteCss)
  styleElement(doc, PAGE_STYLE_ID).textContent = scopeCss(pageCss)
}

export function clearCss(doc: Document): void {
  doc.getElementById(SITE_STYLE_ID)?.remove()
  doc.getElementById(PAGE_STYLE_ID)?.remove()
}
