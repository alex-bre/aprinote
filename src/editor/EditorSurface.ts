import { deactivateEmbeds, resolveAssets, resolveOne, type AssetPort } from './assets/resolve'
import { buildFigure, placeBlock } from './commands/blocks'
import { markBrokenLinks } from './commands/pagelink'
import { queryState, type FormatState } from './commands/state'
import { History, type Snapshot } from './dom/history'
import { attachAtoms, clearAtom, selectedAtom } from './dom/atoms'
import { attachInput } from './dom/input'
import { normalize } from './dom/normalize'
import { outline, type BlockRow } from './dom/outline'
import { attachPicked, pick, pickedPaths } from './dom/picked'
import { captureSelection, restoreSelection, type SelectionPath } from './dom/selection'
import { serializeFragment } from './dom/serialize'
import { tableFrames, type TableFrame } from './table/geometry'

/**
 * The editor port.
 *
 * Everything in `dom/` sits behind this interface; the UI talks to it and never to
 * the DOM directly. That is the safety valve for "the DOM is the model": if input
 * handling proves more painful than expected, a Tiptap/ProseMirror implementation
 * of this same interface is a contained swap rather than a rewrite.
 */

export type EditorEvent = 'change' | 'history' | 'selection'

export interface EditorSurface {
  /**
   * Replace the document. Does not emit `change` — this is a load, not an edit.
   * Resolving assets to blob URLs happens asynchronously afterwards.
   */
  load(fragment: string): void
  /** Insert image files as figures, writing them into the vault first. */
  insertFiles(files: File[]): Promise<void>
  /**
   * Replace the document from the source pane. Unlike `load`, this *is* an
   * edit: it records history and emits `change`.
   */
  setFragment(fragment: string): void
  /** Pretty-printed HTML, as it will land on disk. */
  serialize(): string
  /** Run a registered command, then normalise and snapshot. */
  exec(command: string, args?: unknown): void
  /** Formatting at the caret, for the toolbar and inspector to light up from. */
  queryState(): FormatState
  /** The selected image, table or embed, for the inspector's block panels. */
  selectedAtom(): HTMLElement | null
  /**
   * The blocks a marquee has picked out, in document order. The selection lives
   * in the document as a marker attribute, so it survives a move and an undo —
   * ask after a change, like `blocks()`.
   */
  picked(): number[][]
  /**
   * Replace the block selection. Not an edit: it records no history and emits
   * `selection`, not `change`.
   */
  setPicked(paths: number[][]): void
  /**
   * Every block in document order, with the geometry the gutter draws from and
   * the paths `moveBlock` takes. Measured on call — ask after a change, not on a
   * timer.
   */
  blocks(): BlockRow[]
  /**
   * Every table's geometry, for the overlay handles that add, move and size rows
   * and columns. Measured on call, like `blocks()`.
   */
  tables(): TableFrame[]
  on(event: EditorEvent, listener: () => void): () => void
  undo(): void
  redo(): void
  focus(): void
  destroy(): void
  readonly canUndo: boolean
  readonly canRedo: boolean
}

export type Command = (root: HTMLElement, args?: unknown, options?: SurfaceOptions) => void

/** Formatting commands register here — see `commands/index.ts`. */
export const commands = new Map<string, Command>()

/** Resolves a `data-aprinote` id to the page it names, for hrefs and broken-link marking. */
export type LinkResolver = (id: string) => { path: string; title: string } | null

export interface SurfaceOptions {
  /** Vault-relative path of the open page — asset `src` values are relative to it. */
  pagePath: string
  assets: AssetPort
  resolveLink?: LinkResolver
  /** The same lookup keyed by path, for a page dragged out of the sidebar. */
  resolveLinkByPath?: (path: string) => { id: string; path: string; title: string } | null
}

export function createEditorSurface(root: HTMLElement, options: SurfaceOptions): EditorSurface {
  const history = new History()
  const listeners: Record<EditorEvent, Set<() => void>> = {
    change: new Set(),
    history: new Set(),
    selection: new Set(),
  }

  let composing = false
  let loading = false
  let pending: Snapshot | null = null
  let revokeAssets: (() => void) | null = null

  const emit = (event: EditorEvent) => listeners[event].forEach((listener) => listener())

  const snapshot = (): Snapshot => ({ html: root.innerHTML, selection: captureSelection(root) })

  /**
   * Normalise, then put the caret back where it was. The normaliser rewrites nodes
   * out from under the live Range, so this order is not optional.
   */
  function clean(): boolean {
    const selection = captureSelection(root)
    const { changed } = normalize(root)
    if (changed) restoreSelection(root, selection)
    return changed
  }

  const host = {
    root,
    composing: () => composing,
    setComposing: (value: boolean) => {
      composing = value
    },
    before(kind: 'typing' | 'command') {
      if (loading || composing) return
      // Capture the pre-mutation state once per burst; `after` is what records it.
      pending ??= snapshot()
      if (kind === 'command') history.flush()
    },
    after(kind: 'typing' | 'command') {
      if (loading || composing) return
      if (!pending) return

      clean()
      markBrokenLinks(root, options)
      const before = pending
      pending = null

      if (before.html === root.innerHTML) return
      history.record(before, kind)
      history.record(snapshot(), kind)
      emit('change')
      emit('history')
    },
    undo: () => surface.undo(),
    redo: () => surface.redo(),
    exec: (command: string, args?: unknown) => surface.exec(command, args),
    files: (files: File[]) => void surface.insertFiles(files),
    pageDrop: (path: string, at: { x: number; y: number }) => {
      const target = options.resolveLinkByPath?.(path)
      if (!target) return
      // Put the caret where it was dropped, then insert there.
      const caret = doc.caretRangeFromPoint?.(at.x, at.y)
      if (caret && root.contains(caret.startContainer)) {
        const selection = doc.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(caret)
      }
      surface.exec('pageLink', target)
    },
  }

  // Before the input router, so a block selection is already gone by the time the
  // history snapshot for the keystroke that ends it is taken.
  const detachPicked = attachPicked(root, {
    exec: (command, args) => surface.exec(command, args),
    onChange: () => emit('selection'),
  })
  const detach = attachInput(host)
  const detachAtoms = attachAtoms(root, () => emit('selection'))

  // The selection lives on the document, not the element, so this is the only
  // place it can be observed from.
  const doc = root.ownerDocument
  const onSelectionChange = () => {
    if (loading) return
    const selection = doc.getSelection()
    const anchor = selection?.anchorNode
    if (anchor && root.contains(anchor)) emit('selection')
  }
  doc.addEventListener('selectionchange', onSelectionChange)

  function apply(state: Snapshot): void {
    loading = true
    root.innerHTML = state.html
    restoreSelection(root, state.selection)
    loading = false
    emit('change')
    emit('history')
  }

  const surface: EditorSurface = {
    load(fragment) {
      loading = true
      root.innerHTML = fragment
      clearAtom(root)
      // Before anything paints, so an embed never gets a chance to fetch.
      deactivateEmbeds(root)
      normalize(root)
      markBrokenLinks(root, options)
      loading = false
      history.reset({ html: root.innerHTML, selection: null })
      emit('history')
      emit('selection')

      // Blob URLs for the vault's images. Off the critical path: the text is
      // editable immediately and pictures fill in.
      revokeAssets?.()
      revokeAssets = null
      void resolveAssets(root, options.pagePath, options.assets.read).then((revoke) => {
        revokeAssets = revoke
        // Swapping src is a display concern — it must not look like an edit, so
        // the history baseline moves with it.
        history.reset({ html: root.innerHTML, selection: captureSelection(root) })
      })
    },

    setFragment(fragment) {
      if (root.innerHTML === fragment) return
      const before = snapshot()

      loading = true
      root.innerHTML = fragment
      deactivateEmbeds(root)
      normalize(root)
      markBrokenLinks(root, options)
      // The caret is described by child indices, so it survives the reparse as
      // long as the structure is close — which, mid-edit, it is.
      restoreSelection(root, before.selection)
      loading = false

      history.record(before, 'command')
      history.record(snapshot(), 'command')
      emit('change')
      emit('history')

      void resolveAssets(root, options.pagePath, options.assets.read).then((revoke) => {
        revokeAssets?.()
        revokeAssets = revoke
      })
    },

    async insertFiles(files) {
      host.before('command')
      for (const file of files) {
        // The vault owns naming and collision handling; it hands back the
        // page-relative src to write into the document.
        const src = await options.assets.write(file)
        const figure = buildFigure(root, src, file.name.replace(/\.[^.]+$/, ''))
        const image = figure.querySelector('img')!
        image.setAttribute('data-aprinote-src', src)
        placeBlock(root, figure)
        await resolveOne(image, options.pagePath, options.assets.read)
      }
      host.after('command')
    },

    serialize() {
      return serializeFragment(root)
    },

    exec(command, args) {
      const run = commands.get(command)
      if (!run) return
      root.focus()
      host.before('command')
      run(root, args, options)
      host.after('command')
      emit('selection')
    },

    queryState() {
      return queryState(root)
    },

    selectedAtom() {
      return selectedAtom(root)
    },

    picked() {
      return pickedPaths(root)
    },

    setPicked(paths) {
      if (pick(root, paths)) emit('selection')
    },

    blocks() {
      return outline(root)
    },

    tables() {
      return tableFrames(root)
    },

    on(event, listener) {
      listeners[event].add(listener)
      return () => listeners[event].delete(listener)
    },

    undo() {
      const state = history.undo()
      if (state) apply(state)
    },

    redo() {
      const state = history.redo()
      if (state) apply(state)
    },

    focus() {
      // Never scroll: the caret is where the user left it, and a jump back to it
      // is not what "give the document its keys back" should mean.
      root.focus({ preventScroll: true })
    },

    destroy() {
      detach()
      detachAtoms()
      detachPicked()
      revokeAssets?.()
      doc.removeEventListener('selectionchange', onSelectionChange)
      listeners.change.clear()
      listeners.history.clear()
      listeners.selection.clear()
    },

    get canUndo() {
      return history.canUndo
    },
    get canRedo() {
      return history.canRedo
    },
  }

  return surface
}

export type { SelectionPath, FormatState, BlockRow, TableFrame }
