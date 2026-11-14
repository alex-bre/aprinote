import { useCallback, useEffect, useRef, useState } from 'react'
import { FilePlus } from 'lucide-react'
import { createEditorSurface, type EditorSurface } from '@/editor/EditorSurface'
import { useEditor } from '@/store/editorStore'
import { useVault } from '@/store/vaultStore'
import { writeAsset } from '@/vault/vault'
import type { PageTarget } from '@/editor/commands/pagelink'
import { BlockGutter } from './BlockGutter'
import { BlockSelect } from './BlockSelect'
import { FloatingBar } from './FloatingBar'
import { followLink } from './linkTarget'
import { LinkDialog } from './LinkDialog'
import { PagePicker } from './PagePicker'
import { SlashMenu, type SlashTrigger } from './SlashMenu'
import { TableChrome } from './TableChrome'
import pickerStyles from './PagePicker.module.css'
import styles from './DocPane.module.css'

/**
 * The document pane. `article.aprinote-page` is the editor host — its live DOM *is* the
 * document. Everything about how it behaves lives behind `EditorSurface`;
 * this component owns the element's lifecycle and the two affordances that are
 * chrome rather than editing: the slash menu and the file picker.
 */
/** The `[[` suggestion popover — the input-rule entry point to a page link. */
function WikiPopover({
  trigger,
  onPick,
  onCancel,
}: {
  trigger: SlashTrigger
  onPick: (target: PageTarget) => void
  onCancel: () => void
}) {
  const index = useVault((s) => s.index)
  const openPath = useVault((s) => s.page?.meta.path)
  const pages = [...(index?.pages.values() ?? [])].filter((page) => page.path !== openPath)

  return (
    <div
      className={pickerStyles.popover}
      style={{
        left: Math.max(8, Math.min(trigger.left, window.innerWidth - 328)),
        top: trigger.top + 6,
      }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className={pickerStyles.head}>Link to page</div>
      <PagePicker pages={pages} query={trigger.query} onPick={onPick} onCancel={onCancel} />
    </div>
  )
}

export function DocPane() {
  const path = useVault((s) => s.page?.meta.path)
  const revision = useVault((s) => s.revision)
  const edit = useVault((s) => s.edit)
  const attach = useEditor((s) => s.attach)
  const syncHistory = useEditor((s) => s.syncHistory)
  const setRequestImage = useEditor((s) => s.setRequestImage)

  const host = useRef<HTMLElement>(null)
  const pane = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const surface = useRef<EditorSurface | null>(null)
  const [slash, setSlash] = useState<SlashTrigger | null>(null)
  /** The table showing its handles, so the gutter can yield the left margin. */
  const [tablePath, setTablePath] = useState<number[] | null>(null)
  const [wiki, setWiki] = useState<SlashTrigger | null>(null)
  const [dialog, setDialog] = useState(false)

  // One surface per open page: a new document is a new history.
  useEffect(() => {
    const node = host.current
    if (!node || !path) return

    const { adapter } = useVault.getState()
    const editor = createEditorSurface(node, {
      pagePath: path,
      // `data-aprinote` is the truth, so the editor asks the index what an id
      // means rather than trusting the href it happens to carry.
      resolveLink: (id) => {
        const { index } = useVault.getState()
        const target = index?.byId.get(id)
        const meta = target ? index?.pages.get(target) : undefined
        return meta ? { path: meta.path, title: meta.title } : null
      },
      resolveLinkByPath: (dropped) => {
        const meta = useVault.getState().index?.pages.get(dropped)
        return meta ? { id: meta.id, path: meta.path, title: meta.title } : null
      },
      assets: {
        read: async (assetPath) =>
          adapter ? adapter.readBinary(assetPath).catch(() => null) : null,
        write: async (file) => {
          if (!adapter) throw new Error('No vault is open')
          const src = await writeAsset(adapter, file, path)
          void useVault.getState().refreshIndex()
          return src
        },
      },
    })
    surface.current = editor
    attach(editor)

    const offChange = editor.on('change', () => edit(editor.serialize()))
    const offHistory = editor.on('history', syncHistory)

    editor.load(useVault.getState().page?.fragment ?? '')
    syncHistory()

    return () => {
      offChange()
      offHistory()
      editor.destroy()
      surface.current = null
      attach(null)
    }
  }, [path, edit, attach, syncHistory])

  /**
   * `/` opens the block menu, but only after a space or at the start of a block —
   * otherwise a slash in ordinary prose (a URL, a date) would trigger it.
   */
  const onKeyUp = useCallback(() => {
    const node = host.current
    if (!node) return

    const selection = node.ownerDocument.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      setSlash(null)
      return setWiki(null)
    }

    const range = selection.getRangeAt(0)
    const before = (range.startContainer.nodeValue ?? '').slice(0, range.startOffset)
    const rect = range.getBoundingClientRect()

    // `[[` wins over `/` — the sequence cannot be both.
    const wikiMatch = /\[\[([^[\]]*)$/.exec(before)
    if (wikiMatch) {
      setSlash(null)
      return setWiki({ left: rect.left, top: rect.bottom, query: wikiMatch[1] })
    }
    setWiki(null)

    const match = /(?:^|\s)\/([\w-]*)$/.exec(before)
    if (!match) return setSlash(null)
    setSlash({ left: rect.left, top: rect.bottom, query: match[1] })
  }, [])

  /** Remove the `/query` the user typed, once a block has been chosen. */
  const consumeTrigger = useCallback((consumed: boolean) => {
    const node = host.current
    setSlash(null)
    if (!consumed || !node) return

    const selection = node.ownerDocument.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return

    const text = range.startContainer.nodeValue ?? ''
    const match = /(\/[\w-]*)$/.exec(text.slice(0, range.startOffset))
    if (!match) return
    ;(range.startContainer as Text).deleteData(range.startOffset - match[1].length, match[1].length)
  }, [])

  /**
   * ⌘/Ctrl-click follows a link, the way it does in a browser and in every other
   * editor that has links in it. A plain click still places the caret — this is a
   * writing surface first.
   *
   * The `preventDefault` is not optional even when the link resolves to nothing:
   * a contenteditable browser follows a modified click itself, and following one
   * navigates the window the app is running in.
   */
  const onClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return
    const anchor = (event.target as HTMLElement).closest?.('a')
    if (!anchor) return

    event.preventDefault()
    followLink({ id: anchor.getAttribute('data-aprinote'), href: anchor.getAttribute('href') })
  }, [])

  /**
   * A full-file source edit rewrites the fragment from outside the surface, so the
   * document has to be reloaded. Edits that originate *in* the surface never bump
   * the revision, which is what keeps this from looping.
   */
  useEffect(() => {
    if (!revision) return
    const editor = surface.current
    const fragment = useVault.getState().page?.fragment
    if (editor && fragment !== undefined) editor.load(fragment)
  }, [revision])

  /** Remove the `[[query` the user typed, then insert the link in its place. */
  const pickPage = useCallback((target: PageTarget) => {
    const node = host.current
    setWiki(null)
    if (!node) return

    const selection = node.ownerDocument.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (range?.startContainer.nodeType === Node.TEXT_NODE) {
      const text = range.startContainer.nodeValue ?? ''
      const match = /(\[\[[^[\]]*)$/.exec(text.slice(0, range.startOffset))
      if (match) {
        ;(range.startContainer as Text).deleteData(
          range.startOffset - match[1].length,
          match[1].length,
        )
      }
    }
    surface.current?.exec('pageLink', target)
  }, [])

  /**
   * ⌘K over a selection means "link this"; with nothing selected it is the
   * command palette, which the shell owns. Both listen, so this one has to be the
   * one that declines — otherwise both open at once.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'k') return
      if (surface.current?.queryState().collapsed !== false) return
      event.preventDefault()
      event.stopPropagation()
      setDialog(true)
    }
    // Capture, so this runs before the shell's palette handler.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // The mobile toolbar's image button reaches the picker through the store.
  useEffect(() => {
    setRequestImage(() => picker.current?.click())
    return () => setRequestImage(null)
  }, [setRequestImage])

  const onFiles = useCallback((files: FileList | null) => {
    const images = [...(files ?? [])].filter((file) => file.type.startsWith('image/'))
    if (images.length) void surface.current?.insertFiles(images)
    if (picker.current) picker.current.value = ''
  }, [])

  if (!path) {
    // Reachable on a phone too, where the sidebar is a drawer you have to open —
    // without this a brand-new vault has no way to make its first page.
    return (
      <div className={styles.pane} ref={pane}>
        <div className={styles.empty}>
          <p>No page open.</p>
          <button className={styles.emptyAction} onClick={() => void useVault.getState().createPage('')}>
            <FilePlus size={15} />
            New page
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.pane} ref={pane}>
      <article
        key={path}
        ref={host}
        className="aprinote-page"
        contentEditable
        suppressContentEditableWarning
        spellCheck
        onKeyUp={onKeyUp}
        onClick={onClick}
      />
      <BlockSelect host={host} bounds={pane} />
      <BlockGutter host={host} bounds={pane} hidePath={tablePath} />
      <TableChrome host={host} bounds={pane} onShow={setTablePath} />
      <FloatingBar bounds={pane} />
      {wiki && <WikiPopover trigger={wiki} onPick={pickPage} onCancel={() => setWiki(null)} />}
      {dialog && <LinkDialog onClose={() => setDialog(false)} />}
      {slash && (
        <SlashMenu
          trigger={slash}
          bounds={pane}
          onClose={consumeTrigger}
          onPickImage={() => picker.current?.click()}
        />
      )}
      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => onFiles(event.target.files)}
      />
    </div>
  )
}
