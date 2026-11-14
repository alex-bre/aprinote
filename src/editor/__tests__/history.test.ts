import { describe, expect, it } from 'vitest'
import { COALESCE_MS, History, type Snapshot } from '../dom/history'

const at = (html: string, offset = 0): Snapshot => ({
  html,
  selection: { anchor: [0, 0], anchorOffset: offset, focus: [0, 0], focusOffset: offset },
})

describe('undo / redo', () => {
  it('walks back and forward through commands', () => {
    const history = new History()
    history.reset(at('<p>a</p>'))
    history.record(at('<p>ab</p>'))
    history.record(at('<p>abc</p>'))

    expect(history.canUndo).toBe(true)
    expect(history.undo()?.html).toBe('<p>ab</p>')
    expect(history.undo()?.html).toBe('<p>a</p>')
    expect(history.canUndo).toBe(false)
    expect(history.undo()).toBeNull()

    expect(history.redo()?.html).toBe('<p>ab</p>')
    expect(history.redo()?.html).toBe('<p>abc</p>')
    expect(history.canRedo).toBe(false)
  })

  it('drops the redo branch once you edit after undoing', () => {
    const history = new History()
    history.reset(at('<p>a</p>'))
    history.record(at('<p>ab</p>'))
    history.undo()
    history.record(at('<p>aX</p>'))

    expect(history.canRedo).toBe(false)
    expect(history.undo()?.html).toBe('<p>a</p>')
  })

  it('ignores a record that changes nothing', () => {
    const history = new History()
    history.reset(at('<p>a</p>'))
    history.record(at('<p>a</p>'))
    expect(history.depth).toBe(1)
  })

  it('still updates where undo returns the caret', () => {
    const history = new History()
    history.reset(at('<p>a</p>', 0))
    history.record(at('<p>a</p>', 5))
    expect(history.current?.selection?.anchorOffset).toBe(5)
  })
})

describe('coalescing', () => {
  it('folds a typing burst into one undo step', () => {
    const history = new History()
    history.reset(at('<p></p>'))

    let now = 1000
    for (const html of ['<p>h</p>', '<p>he</p>', '<p>hel</p>', '<p>hell</p>', '<p>hello</p>']) {
      history.record(at(html), 'typing', now)
      now += 50
    }

    expect(history.depth).toBe(2)
    expect(history.undo()?.html).toBe('<p></p>')
  })

  it('starts a new step once typing pauses', () => {
    const history = new History()
    history.reset(at('<p></p>'))

    history.record(at('<p>one</p>'), 'typing', 1000)
    history.record(at('<p>one two</p>'), 'typing', 1000 + COALESCE_MS + 1)

    expect(history.undo()?.html).toBe('<p>one</p>')
    expect(history.undo()?.html).toBe('<p></p>')
  })

  it('breaks the run on a non-typing command', () => {
    const history = new History()
    history.reset(at('<p></p>'))
    history.record(at('<p>a</p>'), 'typing', 1000)
    history.record(at('<h1>a</h1>'), 'command', 1010)
    history.record(at('<h1>ab</h1>'), 'typing', 1020)

    expect(history.undo()?.html).toBe('<h1>a</h1>')
    expect(history.undo()?.html).toBe('<p>a</p>')
  })

  it('flush ends the run even without a pause', () => {
    const history = new History()
    history.reset(at('<p></p>'))
    history.record(at('<p>a</p>'), 'typing', 1000)
    history.flush()
    history.record(at('<p>ab</p>'), 'typing', 1010)

    expect(history.undo()?.html).toBe('<p>a</p>')
  })
})

describe('bounds', () => {
  it('discards the oldest states past the limit', () => {
    const history = new History(5)
    history.reset(at('<p>0</p>'))
    for (let n = 1; n < 20; n++) history.record(at(`<p>${n}</p>`))

    expect(history.depth).toBe(5)
    while (history.canUndo) history.undo()
    expect(history.current?.html).toBe('<p>15</p>')
  })

  it('survives 200 mixed operations', () => {
    const history = new History()
    history.reset(at('<p></p>'))

    const applied: string[] = ['<p></p>']
    let now = 0

    for (let n = 1; n <= 200; n++) {
      now += n % 3 === 0 ? COALESCE_MS + 1 : 10
      const kind = n % 4 === 0 ? 'command' : 'typing'
      const html = `<p>${'x'.repeat(n)}</p>`
      const depthBefore = history.depth
      history.record(at(html), kind, now)
      // Track only the states that actually became their own undo step.
      if (history.depth > depthBefore) applied.push(html)
      else applied[applied.length - 1] = html

      if (n % 17 === 0) {
        const undone = history.undo()
        expect(undone).not.toBeNull()
        expect(undone!.html).toBe(applied[applied.length - 2])
        const redone = history.redo()
        expect(redone!.html).toBe(applied[applied.length - 1])
      }
    }

    // Unwind the whole stack and confirm every step is intact and ordered.
    const seen: string[] = [history.current!.html]
    while (history.canUndo) seen.push(history.undo()!.html)
    expect(seen[seen.length - 1]).toBe('<p></p>')
    expect(seen.reverse()).toEqual(applied.slice(-seen.length))

    while (history.canRedo) history.redo()
    expect(history.current!.html).toBe(applied[applied.length - 1])
  })
})
