import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Code,
  Columns2,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Image as ImageIcon,
  Info,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table as TableIcon,
  Youtube,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEditor } from '@/store/editorStore'
import styles from './SlashMenu.module.css'

interface BlockChoice {
  label: string
  hint: string
  Icon: LucideIcon
  keywords: string
  run: (exec: (command: string, args?: unknown) => void) => void
}

const CHOICES: BlockChoice[] = [
  { label: 'Text', hint: '<p>', Icon: Pilcrow, keywords: 'paragraph body text', run: (e) => e('block', 'p') },
  { label: 'Heading 1', hint: '<h1>', Icon: Heading1, keywords: 'title h1', run: (e) => e('block', 'h1') },
  { label: 'Heading 2', hint: '<h2>', Icon: Heading2, keywords: 'h2', run: (e) => e('block', 'h2') },
  { label: 'Heading 3', hint: '<h3>', Icon: Heading3, keywords: 'h3', run: (e) => e('block', 'h3') },
  { label: 'Heading 4', hint: '<h4>', Icon: Heading4, keywords: 'h4', run: (e) => e('block', 'h4') },
  { label: 'Bulleted list', hint: '<ul>', Icon: List, keywords: 'bullet unordered ul', run: (e) => e('list', 'ul') },
  { label: 'Numbered list', hint: '<ol>', Icon: ListOrdered, keywords: 'number ordered ol', run: (e) => e('list', 'ol') },
  { label: 'Table', hint: '<table>', Icon: TableIcon, keywords: 'grid rows columns', run: (e) => e('table') },
  {
    label: 'Image',
    hint: '<figure>',
    Icon: ImageIcon,
    keywords: 'picture photo figure upload',
    run: (e) => e('pickImage'),
  },
  { label: 'Callout', hint: '<div class="callout">', Icon: Info, keywords: 'note aside admonition', run: (e) => e('callout') },
  {
    label: '2 columns',
    hint: '<div class="columns">',
    Icon: Columns2,
    keywords: 'columns layout side by side two grid',
    run: (e) => e('columns', 2),
  },
  {
    label: '3 columns',
    hint: '<div class="columns">',
    Icon: Columns3,
    keywords: 'columns layout side by side three grid',
    run: (e) => e('columns', 3),
  },
  { label: 'Quote', hint: '<blockquote>', Icon: Quote, keywords: 'blockquote citation', run: (e) => e('block', 'blockquote') },
  { label: 'Code block', hint: '<pre><code>', Icon: Code, keywords: 'pre monospace snippet', run: (e) => e('codeBlock') },
  { label: 'Divider', hint: '<hr>', Icon: Minus, keywords: 'rule separator hr line', run: (e) => e('divider') },
  {
    label: 'Embed',
    hint: '<iframe>',
    Icon: Youtube,
    keywords: 'iframe video youtube map',
    run: (e) => {
      const url = window.prompt('Embed URL')
      if (url?.trim()) e('embed', url.trim())
    },
  },
]

export interface SlashTrigger {
  /** Viewport position of the `/` that opened the menu. */
  left: number
  top: number
  /** Text typed after the slash, used to filter. */
  query: string
}

/**
 * The slash menu. It is driven by the document pane, which owns the `/` detection —
 * this component only renders the choices and runs one.
 */
export function SlashMenu({
  trigger,
  onClose,
  onPickImage,
  bounds,
}: {
  trigger: SlashTrigger
  onClose: (consumed: boolean) => void
  onPickImage: () => void
  bounds?: React.RefObject<HTMLElement | null>
}) {
  const surface = useEditor((s) => s.surface)
  const [active, setActive] = useState(0)
  const menu = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const query = trigger.query.trim().toLowerCase()
    if (!query) return CHOICES
    // A name match ranks above a keyword match, so `/columns` offers columns
    // before the table whose keywords happen to mention them.
    const named = CHOICES.filter((choice) => choice.label.toLowerCase().includes(query))
    const tagged = CHOICES.filter(
      (choice) => !named.includes(choice) && choice.keywords.includes(query),
    )
    return [...named, ...tagged]
  }, [trigger.query])

  useEffect(() => setActive(0), [trigger.query])

  const choose = useMemo(
    () => (choice: BlockChoice) => {
      onClose(true)
      if (!surface) return
      choice.run((command, args) => {
        if (command === 'pickImage') onPickImage()
        else surface.exec(command, args)
      })
    },
    [onClose, onPickImage, surface],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return onClose(false)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        return setActive((at) => (at + 1) % Math.max(1, matches.length))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        return setActive((at) => (at - 1 + matches.length) % Math.max(1, matches.length))
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        if (!matches[active]) return
        event.preventDefault()
        event.stopPropagation()
        choose(matches[active])
      }
    }
    // Capture: the editor's own Enter and Tab handling must not run first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [matches, active, choose, onClose])

  const limit = bounds?.current?.getBoundingClientRect()
  const height = Math.min(320, 44 + matches.length * 34)
  const below = trigger.top + 22
  const top = limit && below + height > limit.bottom ? trigger.top - height - 8 : below
  const left = Math.min(trigger.left, (limit?.right ?? window.innerWidth) - 268)

  if (matches.length === 0) return null

  return (
    <div
      className={styles.menu}
      ref={menu}
      style={{ left: Math.max(8, left), top: Math.max(8, top) }}
      role="listbox"
      aria-label="Insert block"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className={styles.head}>Insert block</div>
      <div className={styles.list}>
        {matches.map((choice, index) => (
          <button
            key={choice.label}
            className={`${styles.item} ${index === active ? styles.on : ''}`}
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(choice)}
          >
            <choice.Icon size={15} />
            <span className={styles.label}>{choice.label}</span>
            <code className={styles.hint}>{choice.hint}</code>
          </button>
        ))}
      </div>
    </div>
  )
}
