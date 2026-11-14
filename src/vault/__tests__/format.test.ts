import { describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../adapters/memory'
import { upgradeLegacyCss, upgradeLegacyMarkup } from '../format'
import { linksIn, rewritePageLinks } from '../links'
import { pageIdIn, parsePage, serializePage } from '../page'
import { scanVault } from '../tree'
import { initVault, savePage } from '../vault'

/** A page as the app wrote it before the rename. */
const legacy = (id: string, body: string, articleClass = 'leaf-page') => `<!doctype html>
<html lang="en">
<head>
  <title>Old</title>
  <meta name="leaf-id" content="${id}">
  <meta name="leaf-edited" content="2026-01-01T00:00:00.000Z">
</head>
<body><article class="${articleClass}">
${body}
</article></body>
</html>
`

describe('upgradeLegacyMarkup', () => {
  it('renames the identity metas, the article class and page links', () => {
    const out = upgradeLegacyMarkup(legacy('pg_old', '<p><a data-leaf="pg_b" href="b.html">B</a></p>'))
    expect(out).toContain('<meta name="aprinote-id" content="pg_old">')
    expect(out).toContain('<meta name="aprinote-edited" content="2026-01-01T00:00:00.000Z">')
    expect(out).toContain('<article class="aprinote-page">')
    expect(out).toContain('<a data-aprinote="pg_b" href="b.html">B</a>')
    expect(out).not.toMatch(/leaf/)
  })

  it('keeps the other classes on the article', () => {
    expect(upgradeLegacyMarkup(legacy('pg_x', '', 'wide leaf-page dark'))).toContain(
      '<article class="wide aprinote-page dark">',
    )
  })

  it('leaves the word alone in prose and in escaped code', () => {
    const body = '<p>A leaf-page, a leaf-id.</p><pre><code>&lt;a data-leaf="x"&gt;</code></pre>'
    expect(upgradeLegacyMarkup(body)).toBe(body)
  })

  it('is idempotent and a no-op on current markup', () => {
    const once = upgradeLegacyMarkup(legacy('pg_old', '<a data-leaf="pg_b">B</a>'))
    expect(upgradeLegacyMarkup(once)).toBe(once)
  })
})

describe('upgradeLegacyCss', () => {
  it('renames the link and page selectors and nothing else', () => {
    const css = 'a[data-leaf] { color: red }\na[data-leaf]:hover {}\n.leaf-page h1 {}\n.leaf-pages {}\n[data-leaf-x] {}\n'
    expect(upgradeLegacyCss(css)).toBe(
      'a[data-aprinote] { color: red }\na[data-aprinote]:hover {}\n.aprinote-page h1 {}\n.leaf-pages {}\n[data-leaf-x] {}\n',
    )
  })

  it('is applied to an existing site.css when the vault opens', async () => {
    const adapter = new MemoryAdapter()
    adapter.reset({ '_vault/site.css': 'body {}\na[data-leaf] { color: red }\n' })
    await initVault(adapter)
    expect(await adapter.read('_vault/site.css')).toBe('body {}\na[data-aprinote] { color: red }\n')
  })
})

describe('a pre-rename page', () => {
  const html = legacy('pg_old', '<h1>Old</h1>\n<p><a data-leaf="pg_b" href="b.html">B</a></p>')

  it('parses with its identity and links intact', () => {
    const page = parsePage(html, 'old.html')
    expect(page.meta.id).toBe('pg_old')
    expect(page.meta.editedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(page.fragment).toContain('<a data-aprinote="pg_b" href="b.html">B</a>')
    expect(page.fragment).not.toContain('<article')
    expect(pageIdIn(html)).toBe('pg_old')
  })

  it('keeps its links and backlinks before it is ever re-saved', () => {
    expect(linksIn(html)).toEqual([{ id: 'pg_b', text: 'B' }])
    expect(rewritePageLinks(html, 'old.html', () => 'sub/b.html')).toContain(
      '<a data-leaf="pg_b" href="sub/b.html">',
    )
  })

  it('is written back in the current names on save', () => {
    const fragment = parsePage(html, 'old.html').fragment
    const out = serializePage(html, fragment, { id: 'pg_old' })
    expect(out).toContain('<meta name="aprinote-id" content="pg_old">')
    expect(out).toContain('<article class="aprinote-page">')
    expect(out).not.toMatch(/leaf/)
    // Still exactly one identity meta: the old one was renamed, not duplicated.
    expect(out.match(/aprinote-id/g)).toHaveLength(1)
  })

  it('keeps its id through a save on a real vault', async () => {
    const adapter = new MemoryAdapter()
    adapter.reset({ 'old.html': html, 'b.html': legacy('pg_b', '<p>B</p>') })
    const index = await scanVault(adapter)
    expect(index.byId.get('pg_old')).toBe('old.html')
    expect(index.backlinks.get('pg_b')?.map((b) => b.path)).toEqual(['old.html'])

    const { id } = await savePage(adapter, 'old.html', '<p>new</p>', null)
    expect(id).toBe('pg_old')
    expect(await adapter.read('old.html')).toContain('<meta name="aprinote-id" content="pg_old">')
  })
})
