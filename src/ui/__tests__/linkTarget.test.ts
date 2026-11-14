import { describe, expect, it } from 'vitest'
import { linkTarget } from '../linkTarget'
import type { VaultIndex } from '@/vault/tree'

/** Just the two maps `linkTarget` reads — the rest of an index is irrelevant here. */
function indexOf(paths: string[], ids: Record<string, string> = {}): VaultIndex {
  return {
    pages: new Map(paths.map((path) => [path, { id: '', path, title: path, editedAt: '' }])),
    byId: new Map(Object.entries(ids)),
  } as unknown as VaultIndex
}

const vault = indexOf(
  ['index.html', 'getting-started.html', 'handbook/index.html', 'handbook/blocks.html'],
  { pg_home: 'index.html', pg_blocks: 'handbook/blocks.html' },
)

describe('linkTarget', () => {
  it('resolves a stable id, whatever the href says', () => {
    expect(linkTarget({ id: 'pg_blocks', href: 'stale/path.html' }, 'index.html', vault)).toEqual({
      kind: 'page',
      path: 'handbook/blocks.html',
    })
  })

  it('falls back to the href when the id resolves to nothing', () => {
    expect(
      linkTarget({ id: 'pg_gone', href: 'getting-started.html' }, 'index.html', vault),
    ).toEqual({ kind: 'page', path: 'getting-started.html' })
  })

  it('resolves a relative href against the page it is written on', () => {
    expect(linkTarget({ href: '../getting-started.html' }, 'handbook/blocks.html', vault)).toEqual({
      kind: 'page',
      path: 'getting-started.html',
    })
    expect(linkTarget({ href: 'blocks.html' }, 'handbook/index.html', vault)).toEqual({
      kind: 'page',
      path: 'handbook/blocks.html',
    })
  })

  it('treats a folder href as its index page', () => {
    for (const href of ['handbook/', 'handbook']) {
      expect(linkTarget({ href }, 'index.html', vault)).toEqual({
        kind: 'page',
        path: 'handbook/index.html',
      })
    }
  })

  it('sends real URLs to a real tab', () => {
    expect(linkTarget({ href: 'https://example.com/x' }, 'index.html', vault)).toEqual({
      kind: 'external',
      url: 'https://example.com/x',
    })
    expect(linkTarget({ href: 'mailto:team@example.com' }, 'index.html', vault)).toEqual({
      kind: 'external',
      url: 'mailto:team@example.com',
    })
  })

  it('gives a protocol-relative href a protocol, rather than the app’s origin', () => {
    expect(linkTarget({ href: '//example.com/x' }, 'index.html', vault)).toEqual({
      kind: 'external',
      url: 'https://example.com/x',
    })
  })

  /** The whole point: anything unresolvable must do nothing at all. */
  it('refuses to navigate anywhere for a link that resolves to nothing', () => {
    const nothing = { kind: 'none' }
    expect(linkTarget({ href: 'does-not-exist.html' }, 'index.html', vault)).toEqual(nothing)
    expect(linkTarget({ id: 'pg_missing', href: '' }, 'index.html', vault)).toEqual(nothing)
    expect(linkTarget({ href: '#section' }, 'index.html', vault)).toEqual(nothing)
    expect(linkTarget({ href: 'javascript:alert(1)' }, 'index.html', vault)).toEqual(nothing)
    expect(linkTarget({}, 'index.html', vault)).toEqual(nothing)
    expect(linkTarget({ href: '_assets/photo.svg' }, 'index.html', vault)).toEqual(nothing)
  })

  it('resolves nothing at all without an index', () => {
    expect(linkTarget({ id: 'pg_home', href: 'index.html' }, 'index.html', null)).toEqual({
      kind: 'none',
    })
  })
})
