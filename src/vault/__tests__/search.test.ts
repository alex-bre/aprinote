import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../adapters/memory'
import { searchVault, unusedAssets } from '../search'
import { plainText, scanVault } from '../tree'

const adapter = new MemoryAdapter()

const page = (id: string, title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title><meta name="aprinote-id" content="${id}">
</head><body><article class="aprinote-page">${body}</article></body></html>`

beforeEach(() => {
  adapter.reset({
    'index.html': page('pg_home', 'Home', '<h1>Home</h1><p>The vault homepage.</p>'),
    'handbook/onboarding.html': page(
      'pg_on',
      'Onboarding Guide',
      '<h1>Onboarding Guide</h1><p>Everything a new teammate needs in the first week.</p>' +
        '<figure><img src="../_assets/office-map.png"></figure>',
    ),
    'specs/review.html': page('pg_rev', 'Review Process', '<p>How code review works here.</p>'),
    '_assets/office-map.png': 'PNG',
    '_assets/orphan.png': 'PNG',
  })
})

describe('plainText', () => {
  it('keeps the words and drops the markup', () => {
    expect(plainText('<p>Hello <strong>there</strong></p>')).toBe('Hello there')
  })

  it('does not index script or style contents', () => {
    expect(plainText('<p>Body</p><style>.a{color:red}</style>')).toBe('Body')
    expect(plainText('<script>secret()</script><p>Body</p>')).toBe('Body')
  })

  it('decodes the entities a page actually carries', () => {
    expect(plainText('<p>a&nbsp;b &amp; c &lt;tag&gt;</p>')).toBe('a b & c <tag>')
  })
})

describe('searchVault', () => {
  it('finds a page by title', async () => {
    const index = await scanVault(adapter)
    const hits = searchVault(index, 'onboarding')
    expect(hits[0].page.title).toBe('Onboarding Guide')
    expect(hits[0].where).toBe('title')
  })

  it('finds a page by its body text, with a snippet', async () => {
    const index = await scanVault(adapter)
    const hits = searchVault(index, 'teammate')

    expect(hits).toHaveLength(1)
    expect(hits[0].page.title).toBe('Onboarding Guide')
    expect(hits[0].where).toBe('text')
    expect(hits[0].snippet).toContain('teammate')
  })

  it('ranks a title match above a body match', async () => {
    adapter.reset({
      'a.html': page('pg_a', 'Widgets', '<p>Nothing here.</p>'),
      'b.html': page('pg_b', 'Other', '<p>All about widgets in detail.</p>'),
    })
    const index = await scanVault(adapter)
    expect(searchVault(index, 'widgets').map((h) => h.page.title)).toEqual(['Widgets', 'Other'])
  })

  it('falls back to the path', async () => {
    const index = await scanVault(adapter)
    const hits = searchVault(index, 'specs/')
    expect(hits[0].page.path).toBe('specs/review.html')
    expect(hits[0].where).toBe('path')
  })

  it('is case-insensitive and ignores an empty query', async () => {
    const index = await scanVault(adapter)
    expect(searchVault(index, 'REVIEW PROCESS')[0].page.title).toBe('Review Process')
    expect(searchVault(index, '   ')).toEqual([])
  })

  it('does not search the head or the stylesheet link', async () => {
    const index = await scanVault(adapter)
    expect(searchVault(index, 'aprinote-id')).toEqual([])
  })
})

describe('unusedAssets', () => {
  it('offers only the files no page references', async () => {
    const index = await scanVault(adapter)
    expect(unusedAssets(['office-map.png', 'orphan.png'], index)).toEqual(['orphan.png'])
  })

  it('counts a reference from any page, at any depth', async () => {
    const index = await scanVault(adapter)
    expect(index.assetRefs.has('office-map.png')).toBe(true)
  })

  it('finds nothing to sweep in a vault with no assets', async () => {
    adapter.reset({ 'a.html': page('pg_a', 'A', '<p>x</p>') })
    const index = await scanVault(adapter)
    expect(unusedAssets([], index)).toEqual([])
  })
})
