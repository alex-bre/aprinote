import { describe, expect, it } from 'vitest'
import { rewriteRootSelectors, scopeCss } from '../css'

describe('rewriteRootSelectors', () => {
  it('turns root-ish heads into the scoping root', () => {
    expect(rewriteRootSelectors('body')).toBe(':scope')
    expect(rewriteRootSelectors('html')).toBe(':scope')
    expect(rewriteRootSelectors(':root')).toBe(':scope')
  })

  it('keeps the rest of the selector', () => {
    expect(rewriteRootSelectors('body p')).toBe(':scope p')
    expect(rewriteRootSelectors('html body h1')).toBe(':scope h1')
    expect(rewriteRootSelectors('body.dark')).toBe(':scope.dark')
    expect(rewriteRootSelectors('html > body')).toBe(':scope')
  })

  it('leaves ordinary selectors alone', () => {
    expect(rewriteRootSelectors('h1')).toBe('h1')
    expect(rewriteRootSelectors('.callout, blockquote p')).toBe('.callout, blockquote p')
    // Not a root head — just a class that starts with the same letters.
    expect(rewriteRootSelectors('.body-text')).toBe('.body-text')
    expect(rewriteRootSelectors('#bodyguard')).toBe('#bodyguard')
  })

  it('collapses duplicates the rewrite creates', () => {
    expect(rewriteRootSelectors('html, body')).toBe(':scope')
    expect(rewriteRootSelectors('body, .callout')).toBe(':scope, .callout')
  })
})

describe('scopeCss', () => {
  it('wraps the sheet in @scope', () => {
    expect(scopeCss('h1 { color: red }')).toBe('@scope (.aprinote-page) {\n h1 { color: red }\n}')
  })

  it('makes a body rule reach the document', () => {
    expect(scopeCss('body { color: red }')).toContain(':scope { color: red }')
  })

  it('emits nothing for an empty sheet', () => {
    expect(scopeCss('')).toBe('')
    expect(scopeCss('   \n  ')).toBe('')
    expect(scopeCss('/* just a comment */')).toBe('')
  })

  it('leaves declarations untouched', () => {
    const out = scopeCss('p { font: 16px/1.75 body, serif; background: url(a.png) }')
    expect(out).toContain('font: 16px/1.75 body, serif')
    expect(out).toContain('url(a.png)')
  })

  it('rewrites inside a media query without touching the prelude', () => {
    const out = scopeCss('@media (max-width: 700px) { body { padding: 0 } }')
    expect(out).toContain('@media (max-width: 700px)')
    expect(out).toContain(':scope { padding: 0 }')
  })

  it('handles several rules in sequence', () => {
    const out = scopeCss('body { color: red } h1 { font-size: 36px } .callout { padding: 12px }')
    expect(out).toContain(':scope { color: red }')
    expect(out).toContain('h1 { font-size: 36px }')
    expect(out).toContain('.callout { padding: 12px }')
  })

  it('strips comments rather than scoping them', () => {
    expect(scopeCss('/* c */ body { color: red }')).not.toContain('/*')
  })

  it('scopes to a different root on request', () => {
    expect(scopeCss('p { margin: 0 }', '.other')).toContain('@scope (.other)')
  })

  it('does not mistake a nested rule for a selector head', () => {
    // CSS nesting: the inner rule is a real selector and should still be rewritten.
    const out = scopeCss('.card { color: red; & p { margin: 0 } }')
    expect(out).toContain('& p')
    expect(out).toContain('color: red')
  })
})
