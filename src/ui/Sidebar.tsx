import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FileCode,
  FilePlus,
  FileX,
  FolderPlus,
  Folder,
  FolderOpen,
  HardDrive,
  Paintbrush,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import { PAGE_DRAG } from '@/editor/dom/input'
import { useSession } from '@/store/sessionStore'
import { useVault } from '@/store/vaultStore'
import { dirname } from '@/vault/paths'
import { nodeKey, type FolderNode, type TreeNode } from '@/vault/types'
import { ContextMenu, type MenuAnchor, type MenuItem } from './ContextMenu'
import styles from './Sidebar.module.css'

/** One row as the user sees it — enough to select it, name it in a prompt, delete it. */
interface RowRef {
  path: string
  label: string
  isFolder: boolean
}

interface RowContext {
  openMenu: (event: React.MouseEvent, row: RowRef, items: MenuItem[]) => void
  drag: string | null
  setDrag: (path: string | null) => void
  dropTarget: string | null
  setDropTarget: (path: string | null) => void
  selected: Set<string>
  /**
   * Applies the click's selection gesture. True means the click *was* the gesture
   * — ⌘/ctrl or shift — and must not also open the page.
   */
  select: (row: RowRef, event: React.MouseEvent) => boolean
  /** What a row action targets: the whole selection when the row is part of it. */
  targets: (row: RowRef) => RowRef[]
  remove: (rows: RowRef[], prompt?: string) => void
  renaming: string | null
  beginRename: (path: string) => void
  endRename: () => void
}

/**
 * Rows in the order they are painted, skipping collapsed subtrees. Shift-click
 * ranges and the Delete key both read the tree through this.
 */
function flatten(nodes: TreeNode[], descend: (path: string) => boolean, out: RowRef[] = []): RowRef[] {
  for (const node of nodes) {
    if (node.kind === 'page') {
      out.push({ path: node.page.path, label: node.page.title, isFolder: false })
    } else {
      out.push({ path: node.path, label: node.page?.title ?? node.name, isFolder: true })
      if (descend(node.path)) flatten(node.children, descend, out)
    }
  }
  return out
}

/**
 * Deleting a folder takes its contents with it, so a selection that holds both a
 * folder and something inside it must only name the folder — the nested delete
 * would otherwise run against a path that no longer exists.
 */
function outermost(paths: string[]): string[] {
  return paths.filter((path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`)))
}

function useRowActions() {
  const vault = useVault()
  return {
    newPage: (dir: string): MenuItem => ({
      label: 'New page',
      Icon: FilePlus,
      onSelect: () => void vault.createPage(dir),
    }),
    newFolder: (dir: string): MenuItem => ({
      label: 'New folder',
      Icon: FolderPlus,
      onSelect: () => {
        const name = window.prompt('Folder name')
        if (name?.trim()) void vault.createFolder(dir, name.trim())
      },
    }),
  }
}

/** The row's label turned editable in place. Enter or blur commits, Escape drops it. */
function NameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  // Blur fires after Enter and after Escape too; only the first one counts.
  const settled = useRef(false)

  useEffect(() => input.current?.select(), [])

  const commit = (value: string) => {
    if (settled.current) return
    settled.current = true
    const name = value.trim()
    if (name && name !== initial) onCommit(name)
    else onCancel()
  }

  return (
    <input
      ref={input}
      className={styles.rename}
      defaultValue={initial}
      spellCheck={false}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') commit(event.currentTarget.value)
        else if (event.key === 'Escape') {
          settled.current = true
          onCancel()
        }
      }}
      onBlur={(event) => commit(event.currentTarget.value)}
    />
  )
}

function Row({ node, ctx }: { node: TreeNode; ctx: RowContext }) {
  const open_ = useVault((s) => s.openPage)
  const setDrawer = useSession((s) => s.setDrawer)
  const openPage = (path: string) => {
    setDrawer(false)
    return open_(path)
  }
  const move = useVault((s) => s.move)
  const rename = useVault((s) => s.rename)
  const addIndexPage = useVault((s) => s.addIndexPage)
  const activePath = useVault((s) => s.page?.meta.path)
  const expanded = useSession((s) => s.expanded)
  const toggleFolder = useSession((s) => s.toggleFolder)
  const expandFolder = useSession((s) => s.expandFolder)
  const actions = useRowActions()

  const isFolder = node.kind === 'folder'
  const path = isFolder ? node.path : node.page.path
  const label = isFolder ? (node.page?.title ?? node.name) : node.page.title
  const pagePath = isFolder ? node.page?.path : node.page.path
  const active = !!pagePath && pagePath === activePath
  const selected = ctx.selected.has(path)
  const row: RowRef = { path, label, isFolder }

  /**
   * A folder's name on disk is its slug, which is what a rename actually moves —
   * so that, not the index page's title, is what the field opens on.
   */
  const editable = isFolder ? (node as FolderNode).name : label
  const renaming = ctx.renaming === path
  const commitName = (name: string) => {
    ctx.endRename()
    void rename(path, name, isFolder)
  }

  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation()
      ctx.setDrag(path)
      e.dataTransfer.effectAllowed = 'copyMove'
      // Dropped on a folder this moves the page; dropped in the document it
      // becomes a stable link. The payload lets the editor tell them apart.
      if (!isFolder) e.dataTransfer.setData(PAGE_DRAG, path)
    },
    onDragEnd: () => {
      ctx.setDrag(null)
      ctx.setDropTarget(null)
    },
  }

  /** Folders accept drops; a page row targets the folder that contains it. */
  const dropDir = isFolder ? node.path : dirname(path)
  const canDrop =
    ctx.drag !== null && ctx.drag !== dropDir && !dropDir.startsWith(`${ctx.drag}/`) && dirname(ctx.drag) !== dropDir

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!canDrop) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      ctx.setDropTarget(dropDir)
    },
    onDragLeave: () => ctx.dropTarget === dropDir && ctx.setDropTarget(null),
    onDrop: (e: React.DragEvent) => {
      if (!canDrop || !ctx.drag) return
      e.preventDefault()
      e.stopPropagation()
      const source = ctx.drag
      ctx.setDrag(null)
      ctx.setDropTarget(null)
      if (dropDir) expandFolder(dropDir)
      void move(source, dropDir, !source.toLowerCase().endsWith('.html'))
    },
  }

  const renameItem = (): MenuItem => ({
    label: 'Rename',
    Icon: Pencil,
    onSelect: () => ctx.beginRename(path),
  })

  const removeItem = (): MenuItem => {
    const targets = ctx.targets(row)
    return {
      label:
        targets.length > 1
          ? `Delete ${targets.length} items`
          : isFolder
            ? 'Delete folder'
            : 'Delete page',
      Icon: Trash2,
      danger: true,
      onSelect: () => ctx.remove(targets),
    }
  }

  const menuItems = (): MenuItem[] => {
    if (!isFolder) {
      return [actions.newPage(dirname(path)), { rule: true, label: '' }, renameItem(), removeItem()]
    }
    const folder = node as FolderNode
    const index = folder.page
    return [
      actions.newPage(folder.path),
      actions.newFolder(folder.path),
      index
        ? {
            // The folder row *is* its index page, so removing the page has to
            // be reachable somewhere — the row itself only offers the whole folder.
            label: 'Delete index page',
            Icon: FileX,
            danger: true,
            onSelect: () =>
              ctx.remove(
                [{ path: index.path, label: index.title, isFolder: false }],
                `Delete the index page of “${label}”? The folder and everything else in it stays.`,
              ),
          }
        : {
            label: 'Add index page',
            Icon: FileCode,
            onSelect: () => void addIndexPage(folder.path),
          },
      { rule: true, label: '' },
      renameItem(),
      removeItem(),
    ]
  }

  const classes = [
    styles.row,
    isFolder ? styles.folder : '',
    active ? styles.active : '',
    selected ? styles.selected : '',
    ctx.dropTarget === dropDir && isFolder ? styles.dropTarget : '',
  ]
    .filter(Boolean)
    .join(' ')

  if (!isFolder) {
    if (renaming) {
      return (
        <div className={classes}>
          <FileCode size={14} color="var(--fg-faint)" />
          <NameInput initial={editable} onCommit={commitName} onCancel={ctx.endRename} />
        </div>
      )
    }
    return (
      <button
        className={classes}
        onClick={(e) => {
          if (ctx.select(row, e)) return
          void openPage(path)
        }}
        onDoubleClick={() => ctx.beginRename(path)}
        onContextMenu={(e) => ctx.openMenu(e, row, menuItems())}
        {...dragProps}
        {...dropProps}
      >
        <FileCode size={14} color={active ? 'var(--accent)' : 'var(--fg-faint)'} />
        <span>{label}</span>
      </button>
    )
  }

  const folder = node as FolderNode
  const open = expanded[folder.path] ?? false
  const Chevron = open ? ChevronDown : ChevronRight
  const FolderIcon = open ? FolderOpen : Folder

  return (
    <>
      <div
        className={classes}
        onContextMenu={(e) => ctx.openMenu(e, row, menuItems())}
        {...(renaming ? {} : dragProps)}
        {...dropProps}
      >
        {/* Two hit targets: the chevron expands, the label opens the index page. */}
        <button
          className={styles.chevron}
          onClick={() => toggleFolder(folder.path)}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          aria-expanded={open}
        >
          <Chevron size={14} color="var(--fg-faint)" />
        </button>
        {renaming ? (
          <div className={styles.folderLabel}>
            <FolderIcon size={14} color="var(--fg-faint)" />
            <NameInput initial={editable} onCommit={commitName} onCancel={ctx.endRename} />
          </div>
        ) : (
          <>
            <button
              className={styles.folderLabel}
              onClick={(e) => {
                if (ctx.select(row, e)) return
                if (folder.page) void openPage(folder.page.path)
                else toggleFolder(folder.path)
              }}
              onDoubleClick={() => ctx.beginRename(folder.path)}
            >
              <FolderIcon size={14} color="var(--fg-faint)" />
              <span>{label}</span>
            </button>
            <span className={styles.count}>{folder.count}</span>
          </>
        )}
      </div>
      {open && folder.children.length > 0 && (
        <div className={styles.children}>
          {folder.children.map((child) => (
            <Row key={nodeKey(child)} node={child} ctx={ctx} />
          ))}
        </div>
      )}
      {open && folder.children.length === 0 && (
        <div className={styles.children}>
          <div className={styles.emptyFolder}>Empty</div>
        </div>
      )}
    </>
  )
}

export function Sidebar() {
  const index = useVault((s) => s.index)
  const ref = useVault((s) => s.ref)
  const createPage = useVault((s) => s.createPage)
  const move = useVault((s) => s.move)
  const openPage = useVault((s) => s.openPage)
  const removeMany = useVault((s) => s.removeMany)
  const activeId = useVault((s) => s.page?.meta.id)
  const backlinks = useVault((s) => s.index?.backlinks)
  const inbound = activeId ? (backlinks?.get(activeId) ?? []) : []
  const openStylesheet = useVault((s) => s.openStylesheet)
  const stylesheetOpen = useVault((s) => !!s.stylesheet)
  const expanded = useSession((s) => s.expanded)
  const rootActions = useRowActions()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /** Where a shift-click measures its range from. */
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const tree = useRef<HTMLDivElement>(null)

  const nodes = index?.tree ?? []
  const visible = useMemo(() => flatten(nodes, (path) => !!expanded[path]), [nodes, expanded])
  const known = useMemo(() => new Set(flatten(nodes, () => true).map((r) => r.path)), [nodes])

  // A rescan can delete out from under the selection — drop what no longer exists.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((path) => known.has(path)))
      return next.size === prev.size ? prev : next
    })
    setRenaming((prev) => (prev && known.has(prev) ? prev : null))
  }, [known])

  const select = (row: RowRef, event: React.MouseEvent): boolean => {
    if (event.shiftKey && anchor && anchor !== row.path) {
      const from = visible.findIndex((r) => r.path === anchor)
      const to = visible.findIndex((r) => r.path === row.path)
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from]
        setSelected(new Set(visible.slice(lo, hi + 1).map((r) => r.path)))
        return true
      }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (!next.delete(row.path)) next.add(row.path)
        return next
      })
      setAnchor(row.path)
      return true
    }
    setSelected(new Set([row.path]))
    setAnchor(row.path)
    return false
  }

  const targets = (row: RowRef): RowRef[] =>
    selected.has(row.path) && selected.size > 1 ? visible.filter((r) => selected.has(r.path)) : [row]

  const remove = (rows: RowRef[], prompt?: string) => {
    const paths = outermost(rows.map((r) => r.path))
    if (paths.length === 0) return
    const only = paths.length === 1 ? rows.find((r) => r.path === paths[0]) : undefined
    const warning =
      prompt ??
      (only
        ? only.isFolder
          ? `Delete “${only.label}” and everything inside it?`
          : `Delete “${only.label}”?`
        : `Delete ${paths.length} selected items, and everything inside any folders among them?`)
    if (!window.confirm(warning)) return
    setSelected(new Set())
    setAnchor(null)
    void removeMany(paths)
  }

  const clearSelection = () => {
    setSelected(new Set())
    setAnchor(null)
  }

  const ctx: RowContext = {
    openMenu: (event, row, items) => {
      event.preventDefault()
      event.stopPropagation()
      // Right-clicking outside the selection moves it, the way a file manager does.
      if (!selected.has(row.path)) {
        setSelected(new Set([row.path]))
        setAnchor(row.path)
      }
      setMenu({ x: event.clientX, y: event.clientY, items })
    },
    drag,
    setDrag,
    dropTarget,
    setDropTarget,
    selected,
    select,
    targets,
    remove,
    renaming,
    beginRename: setRenaming,
    endRename: () => setRenaming(null),
  }

  const rootDropActive = dropTarget === '' && drag !== null

  return (
    <div className={styles.sidebar}>
      <div className={styles.head}>
        <div className={styles.search}>
          <Search size={14} />
          <span>Search pages</span>
          <kbd>⌘K</kbd>
        </div>
        <button className={styles.newPage} title="New page" onClick={() => void createPage('')}>
          <Plus size={15} />
        </button>
      </div>

      <div
        ref={tree}
        className={`${styles.tree} ${rootDropActive ? styles.rootDrop : ''}`}
        tabIndex={-1}
        // Keydown is read on the container so Delete reaches it from whichever row
        // holds focus — and so it can never fire while the caret is in a document.
        onKeyDown={(event) => {
          if (event.key === 'Escape') return clearSelection()
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          if (renaming || selected.size === 0) return
          event.preventDefault()
          remove(visible.filter((r) => selected.has(r.path)))
        }}
        onMouseDown={(event) => {
          // Safari does not focus a clicked button, so the container takes it.
          if (!(event.target instanceof HTMLInputElement)) tree.current?.focus({ preventScroll: true })
          if (!(event.target instanceof Element) || !event.target.closest(`.${styles.row}`)) {
            clearSelection()
          }
        }}
        onDragOver={(e) => {
          if (drag && dirname(drag) !== '') {
            e.preventDefault()
            setDropTarget('')
          }
        }}
        onDrop={(e) => {
          if (!drag || dirname(drag) === '') return
          e.preventDefault()
          const source = drag
          setDrag(null)
          setDropTarget(null)
          void move(source, '', !source.toLowerCase().endsWith('.html'))
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({
            x: e.clientX,
            y: e.clientY,
            items: [rootActions.newPage(''), rootActions.newFolder('')],
          })
        }}
      >
        <div className={styles.group}>
          {nodes.map((node) => (
            <Row key={nodeKey(node)} node={node} ctx={ctx} />
          ))}
        </div>

        {index?.pageCount === 0 && (
          <div className={styles.emptyVault}>
            No pages yet.
            <button className={styles.emptyAction} onClick={() => void createPage('')}>
              Create the first one
            </button>
          </div>
        )}
      </div>

      {selected.size > 1 && (
        <div className={styles.selectionBar}>
          <span>{selected.size} selected</span>
          <button onClick={() => remove(visible.filter((r) => selected.has(r.path)))}>
            <Trash2 size={12} /> Delete
          </button>
          <button onClick={clearSelection}>Clear</button>
        </div>
      )}

      {inbound.length > 0 && (
        <div className={styles.backlinks}>
          <div className={styles.sectionLabel}>Backlinks to this page</div>
          {inbound.map((link) => (
            <button
              key={link.path}
              className={styles.backlink}
              onClick={() => void openPage(link.path)}
              title={link.text || link.title}
            >
              <CornerDownRight size={13} />
              <span>{link.title}</span>
            </button>
          ))}
        </div>
      )}

      <button
        className={`${styles.stylesheet} ${stylesheetOpen ? styles.active : ''}`}
        onClick={() => void openStylesheet()}
        title="Edit the vault stylesheet"
      >
        <Paintbrush size={13} />
        <span>Vault stylesheet</span>
        <code>site.css</code>
      </button>

      <div className={styles.foot} title={ref?.name}>
        <HardDrive size={13} />
        <span>
          {index?.pageCount ?? 0} {index?.pageCount === 1 ? 'page' : 'pages'} · {ref?.name}
        </span>
      </div>

      {menu && <ContextMenu anchor={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
