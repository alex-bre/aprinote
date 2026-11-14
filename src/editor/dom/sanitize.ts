import DOMPurify from 'dompurify'

/**
 * Paste sanitisation.
 *
 * Deliberately permissive: arbitrary HTML *is* the product, so this strips the
 * things that execute rather than the things that look unusual. Scripts, event
 * handlers and `javascript:` URLs go; styles, classes, data attributes and
 * hand-written structure all stay.
 *
 * This applies to pasted content only. The user's own files on disk are never
 * rewritten by it.
 */

const CONFIG = {
  FORBID_TAGS: ['script', 'noscript', 'object', 'embed', 'base', 'form', 'input', 'button', 'meta', 'link'],
  FORBID_ATTR: ['srcdoc', 'formaction', 'ping'],
  ALLOW_DATA_ATTR: true,
  ALLOW_ARIA_ATTR: true,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: true,
  // An iframe embed is a first-class block, so it survives the pass; it is
  // rendered inert while editing and only goes live in the sandboxed preview.
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'scrolling', 'loading', 'target'],
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, CONFIG) as unknown as string
}

/**
 * Pull the best available flavour out of a paste. `text/html` keeps structure;
 * plain text becomes paragraphs so it lands as blocks rather than one run.
 */
export function htmlFromClipboard(data: DataTransfer, doc: Document): string {
  const html = data.getData('text/html')
  if (html) return sanitizeHtml(html)

  const text = data.getData('text/plain')
  if (!text) return ''

  return text
    .split(/\n{2,}/)
    .map((block) => {
      const paragraph = doc.createElement('p')
      paragraph.textContent = block.replace(/\n/g, ' ').trim()
      return paragraph.outerHTML
    })
    .filter((block) => block !== '<p></p>')
    .join('')
}
