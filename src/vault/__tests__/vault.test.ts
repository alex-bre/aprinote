import { beforeEach, describe, expect, it } from 'vitest'
import guide from './fixtures/onboarding-guide.html?raw'
import { MemoryAdapter } from '../adapters/memory'
import { assetsReferencedBy } from '../assets'
import { parsePage } from '../page'
import { scanVault } from '../tree'
import {
  addIndexPage,
  initVault,
  movePage,
  newPage,
  renameFolder,
  renamePage,
  savePage,
} from '../vault'

const adapter = new MemoryAdapter()

/** Every `src`/`href` that points into `_assets/`, exactly as written. */
function assetRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="((?:\.\.\/)*_assets\/[^"]*)"/g)].map((m) => m[1])
}

beforeEach(() => {
  adapter.reset({
    'index.html': '<!doctype html><html><head><title>Home</title></head><body><article class="aprinote-page"><h1>Home</h1></article></body></html>',
    'handbook/onboarding-guide.html': guide,
    '_assets/office-map.png': 'PNG',
    '_vault/site.css': '.aprinote-page{}',
  })
})

describe('scanVault', () => {
  it('hides _assets and _vault, and counts real pages', async () => {
    const index = await scanVault(adapter)
    // Folders stay slugged on disk but read as prose in the tree.
    const names = index.tree.map((n) => (n.kind === 'folder' ? n.name : n.page.title))
    expect(names).toEqual(['Handbook', 'Home'])
    expect(index.pageCount).toBe(2)
    expect(index.byId.get('pg_7f3a')).toBe('handbook/onboarding-guide.html')
  })

  it('absorbs a folder index page into the folder row', async () => {
    await addIndexPage(adapter, 'handbook')
    const index = await scanVault(adapter)
    const handbook = index.tree.find((n) => n.kind === 'folder')
    if (handbook?.kind !== 'folder') throw new Error('expected a folder')

    expect(handbook.page?.path).toBe('handbook/index.html')
    // The index must not also show up as a child row.
    expect(handbook.children.some((c) => c.kind === 'page' && c.page.path.endsWith('index.html'))).toBe(false)
    expect(handbook.children).toHaveLength(1)
  })

  it('keeps the vault root index as an ordinary page', async () => {
    const index = await scanVault(adapter)
    expect(index.pages.has('index.html')).toBe(true)
  })
})

describe('savePage', () => {
  it('writes the fragment and leaves the head intact', async () => {
    await savePage(adapter, 'handbook/onboarding-guide.html', '<p>rewritten</p>', null)
    const after = await adapter.read('handbook/onboarding-guide.html')

    expect(after).toContain('<p>rewritten</p>')
    expect(after).toContain('<link rel="stylesheet" href="../_vault/site.css">')
    expect(parsePage(after, 'handbook/onboarding-guide.html').meta.id).toBe('pg_7f3a')
  })

  it('refuses to clobber a file that changed underneath it', async () => {
    const stale = (await adapter.stat('handbook/onboarding-guide.html'))!.lastModified - 1000
    await adapter.write('handbook/onboarding-guide.html', guide.replace('Week one', 'Changed'))

    await expect(
      savePage(adapter, 'handbook/onboarding-guide.html', '<p>mine</p>', stale),
    ).rejects.toThrow(/changed on disk/)
  })
})

describe('renameFolder', () => {
  it('renames a folder that holds pages', async () => {
    const to = await renameFolder(adapter, 'handbook', 'Field guide')

    expect(to).toBe('field-guide')
    expect(await adapter.exists('field-guide/onboarding-guide.html')).toBe(true)
    expect(await adapter.exists('handbook/onboarding-guide.html')).toBe(false)
  })

  it('keeps an empty folder alive — there is no file to carry it across', async () => {
    await adapter.mkdir('scratch')

    const to = await renameFolder(adapter, 'scratch', 'Drafts')

    expect(to).toBe('drafts')
    expect(await adapter.exists('drafts')).toBe(true)
    expect(await adapter.exists('scratch')).toBe(false)
  })
})

describe('movePage', () => {
  it('rewrites asset depth going deeper', async () => {
    expect(assetRefs(guide)).toEqual(['../_assets/office-map.png'])

    await adapter.mkdir('a/b')
    const index = await scanVault(adapter)
    const to = await movePage(adapter, 'handbook/onboarding-guide.html', 'a/b', index)

    expect(to).toBe('a/b/onboarding-guide.html')
    const moved = await adapter.read(to)
    expect(assetRefs(moved)).toEqual(['../../_assets/office-map.png'])

    // The reference still resolves against the real file.
    const resolved = new URL(assetRefs(moved)[0], `file:///vault/${to}`).pathname
    expect(resolved).toBe('/vault/_assets/office-map.png')
    expect(await adapter.exists('handbook/onboarding-guide.html')).toBe(false)
  })

  it('carries the stylesheet link to the new depth', async () => {
    // A page that moves without this renders unstyled off disk — the whole
    // "the vault is the website" premise depends on it.
    await adapter.mkdir('a/b')
    const index = await scanVault(adapter)
    const to = await movePage(adapter, 'handbook/onboarding-guide.html', 'a/b', index)

    const moved = await adapter.read(to)
    expect(moved).toContain('href="../../_vault/site.css"')
    const resolved = new URL('../../_vault/site.css', `file:///vault/${to}`).pathname
    expect(resolved).toBe('/vault/_vault/site.css')
  })

  it('rewrites asset depth coming back up to the root', async () => {
    const index = await scanVault(adapter)
    const to = await movePage(adapter, 'handbook/onboarding-guide.html', '', index)

    expect(to).toBe('onboarding-guide.html')
    expect(assetRefs(await adapter.read(to))).toEqual(['_assets/office-map.png'])
  })

  it('recomputes the moved page’s own stable-link hrefs', async () => {
    adapter.reset({
      'handbook/guide.html':
        '<!doctype html><html><head><title>G</title><meta name="aprinote-id" content="pg_g"></head><body><article class="aprinote-page"><a data-aprinote="pg_r" href="../specs/review.html">R</a></article></body></html>',
      'specs/review.html':
        '<!doctype html><html><head><title>R</title><meta name="aprinote-id" content="pg_r"></head><body><article class="aprinote-page"></article></body></html>',
    })
    const index = await scanVault(adapter)
    const to = await movePage(adapter, 'handbook/guide.html', '', index)

    expect(await adapter.read(to)).toContain('href="specs/review.html"')
  })

  it('leaves assets on disk when a page is deleted', async () => {
    await adapter.remove('handbook/onboarding-guide.html')
    expect(await adapter.exists('_assets/office-map.png')).toBe(true)
  })

  it('finds the assets a page references', () => {
    expect(assetsReferencedBy(guide)).toEqual(['office-map.png'])
  })
})

describe('renamePage', () => {
  it('renames the file and retitles the document', async () => {
    const to = await renamePage(adapter, 'handbook/onboarding-guide.html', 'First Week')

    expect(to).toBe('handbook/first-week.html')
    const page = parsePage(await adapter.read(to), to)
    expect(page.meta.title).toBe('First Week')
    expect(page.fragment).toContain('<h1>First Week</h1>')
    expect(page.meta.id).toBe('pg_7f3a')
  })

  it('retitles an index page without moving its folder', async () => {
    await addIndexPage(adapter, 'handbook')
    const to = await renamePage(adapter, 'handbook/index.html', 'The Handbook')

    expect(to).toBe('handbook/index.html')
    expect(parsePage(await adapter.read(to), to).meta.title).toBe('The Handbook')
  })

  it('sidesteps a filename collision', async () => {
    await newPage(adapter, 'handbook', 'Taken')
    const to = await renamePage(adapter, 'handbook/onboarding-guide.html', 'Taken')
    expect(to).toBe('handbook/taken-1.html')
  })
})

describe('initVault', () => {
  it('writes defaults once and never overwrites them', async () => {
    adapter.reset({ 'index.html': '<html></html>' })
    await initVault(adapter)
    expect(await adapter.exists('_vault/site.css')).toBe(true)
    expect(await adapter.exists('_vault/vault.json')).toBe(true)

    await adapter.write('_vault/site.css', 'MINE')
    await initVault(adapter)
    expect(await adapter.read('_vault/site.css')).toBe('MINE')
  })
})
