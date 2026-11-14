import { describe, expect, it } from 'vitest'
import { assetMime, assetName, assetsReferencedBy, inlineAssets } from '../assets'

describe('assetMime', () => {
  it('types an asset by its extension, whatever the case', () => {
    expect(assetMime('_assets/photo.PNG')).toBe('image/png')
    expect(assetMime('map.svg')).toBe('image/svg+xml')
    expect(assetMime('clip.jpeg')).toBe('image/jpeg')
  })

  it('has nothing to say about an extension it does not know', () => {
    expect(assetMime('notes.xyz')).toBe('')
    expect(assetMime('LICENSE')).toBe('')
    expect(assetMime('.gitignore')).toBe('')
  })
})

describe('assetName', () => {
  it('is the filename on disk, decoded', () => {
    expect(assetName('../_assets/office%20map.png')).toBe('office map.png')
    expect(assetName('_assets/map.png?v=2')).toBe('map.png')
    expect(assetName('../../_assets/map.png#top')).toBe('map.png')
  })

  it('survives an href that is not decodable', () => {
    expect(assetName('_assets/100%.png')).toBe('100%.png')
  })
})

describe('inlineAssets', () => {
  const html =
    '<p><img src="../_assets/map.png" alt="a"></p>' +
    '<figure><img src="_assets/photo.svg"></figure>' +
    '<iframe src="https://example.com/embed"></iframe>' +
    '<link rel="stylesheet" href="../_vault/site.css">'

  it('swaps in the URL the caller has for each reference', () => {
    const out = inlineAssets(html, { 'map.png': 'data:image/png;base64,AAA' })
    expect(out).toContain('<img src="data:image/png;base64,AAA" alt="a">')
  })

  /** The preview frame has no origin: an unresolved src must not become a request. */
  it('falls back for a reference it has no URL for', () => {
    const out = inlineAssets(html, {}, 'data:blank')
    expect(out).toContain('<img src="data:blank" alt="a">')
    expect(out).toContain('<img src="data:blank">')
  })

  it('leaves a reference alone when there is no fallback either', () => {
    expect(inlineAssets(html, {})).toContain('src="../_assets/map.png"')
  })

  it('touches neither embeds nor the stylesheet link', () => {
    const out = inlineAssets(html, { 'map.png': 'data:x' }, 'data:blank')
    expect(out).toContain('<iframe src="https://example.com/embed">')
    expect(out).toContain('href="../_vault/site.css"')
  })

  it('matches what the scanner reports, percent-encoding included', () => {
    const encoded = '<img src="../_assets/office%20map.png">'
    expect(assetsReferencedBy(encoded)).toEqual(['office map.png'])
    expect(inlineAssets(encoded, { 'office map.png': 'data:y' })).toContain('src="data:y"')
  })
})
