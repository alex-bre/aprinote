import { describe, expect, it } from 'vitest'
import guide from './fixtures/onboarding-guide.html?raw'
import { createPage, parsePage, serializePage } from '../page'

describe('parsePage', () => {
  it('reads identity and the fragment out of a document', () => {
    const page = parsePage(guide, 'handbook/onboarding-guide.html')
    expect(page.meta.id).toBe('pg_7f3a')
    expect(page.meta.title).toBe('Onboarding Guide')
    expect(page.fragment).toContain('<h1>Onboarding Guide</h1>')
    expect(page.fragment).not.toContain('<article')
    expect(page.pageStyle).toContain('.callout')
  })

  it('falls back to the body when there is no aprinote-page article', () => {
    const plain = '<!doctype html><html><head><title>Plain</title></head><body><p>Hi</p></body></html>'
    const page = parsePage(plain, 'plain.html')
    expect(page.fragment).toBe('<p>Hi</p>')
    expect(page.meta.id).toBe('')
  })

  it('titles an untitled file from its filename', () => {
    expect(parsePage('<html><body></body></html>', 'a/some-notes.html').meta.title).toBe('some-notes')
  })
})

describe('serializePage', () => {
  it('preserves everything outside the article byte-for-byte', () => {
    const out = serializePage(guide, '<p>replaced</p>', { id: 'pg_7f3a' })

    const head = (html: string) => html.slice(0, html.indexOf('<body>'))
    expect(head(out).replace(/content="[^"]*"(?=[^>]*>)/g, (m) => m)).toContain('<link rel="stylesheet" href="../_vault/site.css">')
    expect(head(out)).toContain('.callout { background: #dce7fd')
    expect(out).toContain('<!doctype html>')
    expect(out).toContain('<body><article class="aprinote-page">')
    expect(out).toContain('<p>replaced</p>')
    expect(out).not.toContain('Week one checklist')
  })

  it('round-trips a fragment unchanged', () => {
    const parsed = parsePage(guide, 'handbook/onboarding-guide.html')
    const out = serializePage(guide, parsed.fragment)
    expect(parsePage(out, 'handbook/onboarding-guide.html').fragment).toBe(parsed.fragment)
  })

  it('stamps aprinote-edited, and adds the meta when a file lacks it', () => {
    const before = /content="([^"]+)"/.exec(
      /<meta name="aprinote-edited"[^>]*>/.exec(guide)![0],
    )![1]
    const out = serializePage(guide, '<p>x</p>', { editedAt: '2030-01-01T00:00:00.000Z' })
    expect(out).toContain('<meta name="aprinote-edited" content="2030-01-01T00:00:00.000Z">')
    expect(out).not.toContain(before)

    const bare = '<!doctype html><html><head><title>Bare</title>\n</head><body><article class="aprinote-page"></article></body></html>'
    expect(serializePage(bare, '<p>y</p>', { id: 'pg_new' })).toContain('<meta name="aprinote-id" content="pg_new">')
  })

  it('balances nested article tags', () => {
    const nested =
      '<body><article class="aprinote-page"><article>inner</article>tail</article></body>'
    expect(serializePage(nested, 'NEW')).toContain('<article class="aprinote-page">\nNEW\n</article>')
  })
})

describe('createPage', () => {
  it('writes a complete document whose stylesheet link matches its depth', () => {
    expect(createPage('index.html', 'Home')).toContain('href="_vault/site.css"')
    expect(createPage('a/b/deep.html', 'Deep')).toContain('href="../../_vault/site.css"')

    const page = parsePage(createPage('handbook/guide.html', 'Guide', 'pg_abc'), 'handbook/guide.html')
    expect(page.meta.id).toBe('pg_abc')
    expect(page.meta.title).toBe('Guide')
  })

  it('escapes a title that would otherwise break the markup', () => {
    expect(createPage('x.html', 'A & B <script>')).toContain('<title>A &amp; B &lt;script&gt;</title>')
  })
})
