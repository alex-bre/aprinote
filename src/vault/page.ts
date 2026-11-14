import type { PageMeta } from './types'
import { relativeHref, stem } from './paths'
import { EDITED_META, ID_META, PAGE_CLASS, upgradeLegacyMarkup } from './format'

export interface ParsedPage {
  meta: PageMeta
  /** innerHTML of `article.aprinote-page` — the only region the editor touches. */
  fragment: string
  /** Concatenated text of the document's own `<style>` blocks. */
  pageStyle: string
}

/** The opening tag of `article.${PAGE_CLASS}`. */
const ARTICLE_OPEN = /<article\b[^>]*\bclass\s*=\s*["'][^"']*\baprinote-page\b[^"']*["'][^>]*>/i

let idCounter = 0

/** Ids only need to be unique within a vault; the file is what makes them stable. */
export function newPageId(): string {
  const random = Math.random().toString(16).slice(2, 6)
  return `pg_${random}${(idCounter++ % 16).toString(16)}`
}

function parser(): DOMParser {
  return new DOMParser()
}

export function parsePage(html: string, path: string): ParsedPage {
  const doc = parser().parseFromString(upgradeLegacyMarkup(html), 'text/html')
  const article = doc.querySelector(`article.${PAGE_CLASS}`)
  const meta = (name: string) =>
    doc.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? ''

  return {
    meta: {
      id: meta(ID_META),
      path,
      title: doc.title || stem(path),
      editedAt: meta(EDITED_META),
    },
    // A file with no page article is still a page — treat its body as the
    // fragment so hand-written HTML dropped into a vault stays editable.
    fragment: (article ?? doc.body)?.innerHTML.trim() ?? '',
    pageStyle: [...doc.querySelectorAll('head style')].map((s) => s.textContent ?? '').join('\n'),
  }
}

/**
 * Find the article's inner span in the *source text* rather than re-serialising a
 * parsed DOM, so head, doctype and anything outside the article survive a save
 * byte-for-byte. Balances nested `<article>` tags.
 */
function articleBounds(html: string): { start: number; end: number } | null {
  const open = ARTICLE_OPEN.exec(html)
  if (!open) return null

  const start = open.index + open[0].length
  const tag = /<(\/?)article\b/gi
  tag.lastIndex = start

  let depth = 1
  for (let match = tag.exec(html); match; match = tag.exec(html)) {
    depth += match[1] ? -1 : 1
    if (depth === 0) return { start, end: match.index }
  }
  return null
}

function replaceMeta(html: string, name: string, content: string): string {
  const existing = new RegExp(`(<meta\\s+name=["']${name}["']\\s+content=["'])[^"']*(["'][^>]*>)`, 'i')
  if (existing.test(html)) return html.replace(existing, `$1${content}$2`)

  const tag = `  <meta name="${name}" content="${content}">\n`
  const title = /<\/title>\s*\n?/i.exec(html)
  if (title) {
    const at = title.index + title[0].length
    return html.slice(0, at) + tag + html.slice(at)
  }
  return html.replace(/<head[^>]*>\s*\n?/i, (head) => head + tag)
}

export interface SerializeOptions {
  id?: string
  editedAt?: string
  /** False to leave `aprinote-edited` alone — for the in-memory fragment↔document sync. */
  stamp?: boolean
}

/** The page id a document carries, or '' for a page the app has never saved. */
export function pageIdIn(html: string): string {
  return parsePage(html, '').meta.id
}

/** Splice a new fragment back into the document it came from. */
export function serializePage(
  original: string,
  fragment: string,
  options: SerializeOptions = {},
): string {
  original = upgradeLegacyMarkup(original)
  const bounds = articleBounds(original)
  const body = bounds
    ? original.slice(0, bounds.start) + `\n${fragment}\n` + original.slice(bounds.end)
    : original

  let html = body
  if (options.id) html = replaceMeta(html, ID_META, options.id)
  if (options.stamp !== false) {
    html = replaceMeta(html, EDITED_META, options.editedAt ?? new Date().toISOString())
  }
  return html
}

/** A fresh, complete, browsable document. */
export function createPage(path: string, title: string, id = newPageId()): string {
  const siteCss = relativeHref(path, '_vault/site.css')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="${ID_META}" content="${id}">
  <meta name="${EDITED_META}" content="${new Date().toISOString()}">
  <link rel="stylesheet" href="${siteCss}">
</head>
<body><article class="${PAGE_CLASS}">
<h1>${escapeHtml(title)}</h1>
<p></p>
</article></body>
</html>
`
}

/** Retitle a document: the `<title>`, and the leading `<h1>` when it still matched. */
export function retitle(html: string, from: string, to: string): string {
  let out = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(to)}</title>`)
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(out)
  if (heading && heading[1].trim() === from) {
    out = out.slice(0, heading.index) + heading[0].replace(heading[1], escapeHtml(to)) + out.slice(heading.index + heading[0].length)
  }
  return out
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
