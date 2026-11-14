import type { SelectionPath } from './selection'

/**
 * Undo / redo.
 *
 * The native undo stack desyncs the moment the DOM is mutated outside
 * `execCommand`, so we own it outright: a snapshot stack of `{ html, selection }`.
 * For note-sized documents the memory cost is irrelevant; the subtlety is all in
 * selection restoration, which is why selection paths come first.
 */

export interface Snapshot {
  html: string
  selection: SelectionPath | null
}

/** Typing coalesces into one undo step until this much idle time passes. */
export const COALESCE_MS = 400

const LIMIT = 300

export class History {
  private stack: Snapshot[] = []
  private index = -1
  private lastTypedAt = 0
  private typing = false

  constructor(private readonly limit = LIMIT) {}

  /** Start over from a known state — a page load, not an edit. */
  reset(snapshot: Snapshot): void {
    this.stack = [snapshot]
    this.index = 0
    this.typing = false
    this.lastTypedAt = 0
  }

  /**
   * Record a new state. Consecutive typing inside the coalesce window replaces the
   * top entry instead of stacking, so one undo removes a word rather than a letter.
   */
  record(snapshot: Snapshot, kind: 'typing' | 'command' = 'command', now = Date.now()): void {
    if (this.index >= 0 && this.stack[this.index].html === snapshot.html) {
      // Selection-only movement still updates where undo will return to.
      this.stack[this.index] = snapshot
      return
    }

    const coalesce = kind === 'typing' && this.typing && now - this.lastTypedAt < COALESCE_MS
    this.typing = kind === 'typing'
    this.lastTypedAt = now

    if (coalesce && this.index >= 0) {
      this.stack[this.index] = snapshot
      return
    }

    this.stack.length = this.index + 1
    this.stack.push(snapshot)

    if (this.stack.length > this.limit) this.stack.shift()
    this.index = this.stack.length - 1
  }

  /** End the current coalescing run — a non-typing command, or blur. */
  flush(): void {
    this.typing = false
  }

  undo(): Snapshot | null {
    if (!this.canUndo) return null
    this.flush()
    this.index--
    return this.stack[this.index]
  }

  redo(): Snapshot | null {
    if (!this.canRedo) return null
    this.flush()
    this.index++
    return this.stack[this.index]
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }

  get current(): Snapshot | null {
    return this.stack[this.index] ?? null
  }

  get depth(): number {
    return this.stack.length
  }
}
