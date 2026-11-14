import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../adapters/memory'
import { buildBacklinks, linksIn, retitleLinks, rewritePageLinks } from '../links'
import { scanVault } from '../tree'
import { movePage, moveFolder, renamePage } from '../vault'

const adapter = new MemoryAdapter()

function page(id: string, title: string, body = ''): string {
  return `<!doctype html><html><head><title>${title}</title><meta name="aprinote-id" content="${id}">
</head><body><article class="aprinote-page">${body}</article></body></html>`
}

const link = (id: string, href: string, text: string) =>
  `<a data-aprinote="${id}" href="${href}">${text}</a>`

beforeEach(() => {
  adapter.reset({
    // handbook/guide.html links to both of the others.
    'handbook/guide.html': page(
      'pg_guide',
      'Guide',
      `<p>See ${link('pg_review', '../specs/review-process.html', 'Review Process')} and ` +
        `${link('pg_home', '../index.html', 'Home')}.</p>`,
    ),
    'specs/review-process.html': page('pg_review', 'Review Process', '<p>Specs.</p>'),
    'index.html': page('pg_home', 'Home', `<p>${link('pg_review', 'specs/review-process.html', 'Review Process')}</p>`),
  })
})

describe('linksIn', () => {
  it('finds every stable link with its text', () => {
    expect(linksIn(`<p>${link('pg_a', 'a.html', 'Alpha')}</p>`)).toEqual([
      { id: 'pg_a', text: 'Alpha' },
    ])
  })

  it('strips markup out of the link text', () => {
    expect(linksIn(link('pg_a', 'a.html', '<strong>Al</strong>pha'))[0].text).toBe('Alpha')
  })

  it('ignores ordinary links', () => {
    expect(linksIn('<a href="https://example.com">External</a>')).toEqual([])
  })
})

describe('buildBacklinks', () => {
  it('inverts outgoing links into inbound ones', async () => {
    const index = await scanVault(adapter)
    const inbound = index.backlinks.get('pg_review') ?? []

    expect(inbound.map((entry) => entry.path).sort()).toEqual([
      'handbook/guide.html',
      'index.html',
    ])
    expect(index.backlinks.get('pg_guide')).toBeUndefined()
  })

  it('lists a source once however many times it links', () => {
    const outgoing = new Map([['a.html', [{ id: 'pg_b', text: 'B' }, { id: 'pg_b', text: 'B again' }]]])
    const pages = new Map([['a.html', { id: 'pg_a', title: 'A' }]])
    const byId = new Map([['pg_b', 'b.html']])
    expect(buildBacklinks(outgoing, pages, byId).get('pg_b')).toHaveLength(1)
  })

  it('gives a dangling id no backlink to follow', () => {
    const outgoing = new Map([['a.html', [{ id: 'pg_gone', text: 'Gone' }]]])
    const pages = new Map([['a.html', { id: 'pg_a', title: 'A' }]])
    expect(buildBacklinks(outgoing, pages, new Map()).size).toBe(0)
  })
})

describe('rewritePageLinks', () => {
  it('recomputes hrefs from the id, not from the old href', () => {
    const html = link('pg_x', 'wrong/path.html', 'X')
    const out = rewritePageLinks(html, 'a/b/page.html', () => 'specs/target.html')
    expect(out).toContain('href="../../specs/target.html"')
  })

  it('adds an href to a link that has none', () => {
    const out = rewritePageLinks('<a data-aprinote="pg_x">X</a>', 'index.html', () => 'a.html')
    expect(out).toContain('href="a.html"')
  })

  it('leaves an unresolvable id at its last known href', () => {
    const html = link('pg_gone', '../old/place.html', 'Gone')
    expect(rewritePageLinks(html, 'a/b.html', () => undefined)).toBe(html)
  })
})

describe('retitleLinks', () => {
  it('updates link text that still matched the old title', () => {
    const html = link('pg_a', 'a.html', 'Old Name')
    expect(retitleLinks(html, 'pg_a', 'Old Name', 'New Name')).toContain('>New Name<')
  })

  it('leaves a hand-written label alone', () => {
    const html = link('pg_a', 'a.html', 'see this thing')
    expect(retitleLinks(html, 'pg_a', 'Old Name', 'New Name')).toBe(html)
  })

  it('leaves other pages’ links alone', () => {
    const html = link('pg_b', 'b.html', 'Old Name')
    expect(retitleLinks(html, 'pg_a', 'Old Name', 'New Name')).toBe(html)
  })
})

/** Move a linked page across folders, then rename it. */
describe('inbound links survive a move and a rename', () => {
  const hrefsIn = (html: string) =>
    [...html.matchAll(/<a[^>]*data-aprinote="([^"]+)"[^>]*href="([^"]*)"/g)].map((m) => [m[1], m[2]])

  it('rewrites every inbound href when a page moves', async () => {
    const index = await scanVault(adapter)
    const to = await movePage(adapter, 'specs/review-process.html', 'handbook', index)
    expect(to).toBe('handbook/review-process.html')

    // From handbook/guide.html the target is now a sibling.
    expect(hrefsIn(await adapter.read('handbook/guide.html'))).toContainEqual([
      'pg_review',
      'review-process.html',
    ])
    // From the root index it is one level down.
    expect(hrefsIn(await adapter.read('index.html'))).toContainEqual([
      'pg_review',
      'handbook/review-process.html',
    ])
  })

  it('rewrites inbound hrefs and titles when a page is renamed', async () => {
    const index = await scanVault(adapter)
    const to = await renamePage(adapter, 'specs/review-process.html', 'Review Ritual', index)
    expect(to).toBe('specs/review-ritual.html')

    const guide = await adapter.read('handbook/guide.html')
    expect(hrefsIn(guide)).toContainEqual(['pg_review', '../specs/review-ritual.html'])
    // The label tracked the title because it still matched it.
    expect(guide).toContain('>Review Ritual<')
  })

  it('resolves every link after a move and a rename together', async () => {
    let index = await scanVault(adapter)
    await movePage(adapter, 'specs/review-process.html', 'handbook', index)

    index = await scanVault(adapter)
    const to = await renamePage(adapter, 'handbook/review-process.html', 'Ritual', index)

    // Every href in the vault must resolve to a file that exists — which is what
    // "still works in a plain browser opened off disk" means.
    index = await scanVault(adapter)
    for (const [path] of index.pages) {
      const html = await adapter.read(path)
      for (const [, href] of hrefsIn(html)) {
        const resolved = new URL(href, `https://v/${path}`).pathname.slice(1)
        expect(await adapter.exists(resolved)).toBe(true)
      }
    }
    expect(to).toBe('handbook/ritual.html')
  })

  it('rewrites inbound links for every page in a moved folder', async () => {
    const index = await scanVault(adapter)
    await moveFolder(adapter, 'specs', 'handbook', index)

    expect(hrefsIn(await adapter.read('handbook/guide.html'))).toContainEqual([
      'pg_review',
      'specs/review-process.html',
    ])
    expect(await adapter.exists('handbook/specs/review-process.html')).toBe(true)
  })

  it('leaves a link to a deleted page at its last known href', async () => {
    await adapter.remove('specs/review-process.html')
    // Rescan, so the id genuinely resolves to nothing any more.
    const index = await scanVault(adapter)
    expect(index.byId.has('pg_review')).toBe(false)

    await movePage(adapter, 'handbook/guide.html', '', index)

    // Untouched rather than rewritten to nowhere — the static site degrades
    // gracefully instead of pointing at a path that never existed.
    expect(hrefsIn(await adapter.read('guide.html'))).toContainEqual([
      'pg_review',
      '../specs/review-process.html',
    ])
    // The link that *does* still resolve was recomputed for the new depth.
    expect(hrefsIn(await adapter.read('guide.html'))).toContainEqual(['pg_home', 'index.html'])
  })
})

describe('folder index pages as link targets', () => {
  it('links to the index file, never a bare directory', async () => {
    adapter.reset({
      'handbook/index.html': page('pg_hb', 'Handbook'),
      'note.html': page('pg_note', 'Note', link('pg_hb', 'wrong.html', 'Handbook')),
    })
    const index = await scanVault(adapter)
    const out = rewritePageLinks(await adapter.read('note.html'), 'note.html', (id) =>
      index.byId.get(id),
    )
    expect(out).toContain('href="handbook/index.html"')
  })
})
