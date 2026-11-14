/**
 * The vault's on-disk vocabulary: the names a page file carries so the
 * app can find its identity, its editable region and its stable links.
 *
 * Pages written before the project was renamed use `leaf` in place of
 * `aprinote` — `leaf-id`, `article.leaf-page`, `data-leaf`. Those vaults still
 * open: every document passes through `upgradeLegacyMarkup` on its way in and on
 * its way out, so the app only ever deals in the current names, and an old page
 * is rewritten in the current ones the next time it is saved. No page is
 * rewritten just by opening it; only `site.css` is (see `upgradeLegacyCss`).
 */

export const PAGE_CLASS = 'aprinote-page'
export const ID_META = 'aprinote-id'
export const EDITED_META = 'aprinote-edited'
export const LINK_ATTR = 'data-aprinote'

const LEGACY_META = /(<meta\b[^>]*?\bname\s*=\s*["'])leaf-(id|edited)(["'])/gi
const LEGACY_ARTICLE = /(<article\b[^>]*?\bclass\s*=\s*["'](?:[^"']*\s)?)leaf-page(?=[\s"'])/gi
// `\s*=` after the name keeps editor-only `data-leaf-*` attributes out of it.
const LEGACY_LINK = /(<a\b[^>]*?\s)data-leaf(\s*=)/gi

/**
 * The same rename for a stylesheet: a vault made before it has the old default
 * `site.css`, whose page-link rules select `a[data-leaf]`. Without this, links
 * lose their styling as soon as their page is saved in the new names.
 */
export function upgradeLegacyCss(css: string): string {
  if (!css.includes('leaf')) return css
  return css
    .replace(/\[data-leaf(?=[\]=~|^$*\s])/g, `[${LINK_ATTR}`)
    .replace(/\.leaf-page(?![\w-])/g, `.${PAGE_CLASS}`)
}

/** Rename the pre-rename `leaf` markup to the current names. Idempotent. */
export function upgradeLegacyMarkup(html: string): string {
  if (!html.includes('leaf')) return html
  return html
    .replace(LEGACY_META, `$1aprinote-$2$3`)
    .replace(LEGACY_ARTICLE, `$1${PAGE_CLASS}`)
    .replace(LEGACY_LINK, `$1${LINK_ATTR}$2`)
}
