import { describe, expect, it } from 'vitest'
import { assetSrc, depthOf, isReserved, relativeHref, slugify, uniquePath } from '../paths'

describe('depth', () => {
  it('counts directories, not segments', () => {
    expect(depthOf('index.html')).toBe(0)
    expect(depthOf('handbook/guide.html')).toBe(1)
    expect(depthOf('a/b/c.html')).toBe(2)
  })
})

describe('assetSrc', () => {
  it('climbs back to the root from any depth', () => {
    expect(assetSrc('index.html', 'map.png')).toBe('_assets/map.png')
    expect(assetSrc('handbook/guide.html', 'map.png')).toBe('../_assets/map.png')
    expect(assetSrc('a/b/c/deep.html', 'map.png')).toBe('../../../_assets/map.png')
  })
})

describe('relativeHref', () => {
  it('walks up and back down between siblings', () => {
    expect(relativeHref('handbook/guide.html', 'specs/review.html')).toBe('../specs/review.html')
    expect(relativeHref('handbook/guide.html', 'handbook/welcome.html')).toBe('welcome.html')
    expect(relativeHref('index.html', 'handbook/guide.html')).toBe('handbook/guide.html')
    expect(relativeHref('a/b/deep.html', 'index.html')).toBe('../../index.html')
  })

  it('always emits a filename, never a bare directory', () => {
    expect(relativeHref('a/page.html', 'handbook/index.html')).toBe('../handbook/index.html')
  })
})

describe('isReserved', () => {
  it('hides storage directories, not pages that merely look like them', () => {
    expect(isReserved('_assets/map.png')).toBe(true)
    expect(isReserved('_vault/site.css')).toBe(true)
    expect(isReserved('handbook/guide.html')).toBe(false)
    expect(isReserved('notes/_assets-plan.html')).toBe(false)
  })
})

describe('slugify', () => {
  it('produces a filesystem-safe stem', () => {
    expect(slugify('Onboarding Guide')).toBe('onboarding-guide')
    expect(slugify('Tooling & Access')).toBe('tooling-access')
    expect(slugify('  ???  ')).toBe('untitled')
  })
})

describe('uniquePath', () => {
  it('suffixes around collisions and keeps the extension', () => {
    const taken = new Set(['a/report.html', 'a/report-1.html'])
    expect(uniquePath('a/report.html', (p) => taken.has(p))).toBe('a/report-2.html')
    expect(uniquePath('a/fresh.html', (p) => taken.has(p))).toBe('a/fresh.html')
  })
})
