import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import styles from './ContextMenu.module.css'

export interface MenuItem {
  label: string
  Icon?: LucideIcon
  onSelect?: () => void
  disabled?: boolean
  danger?: boolean
  /** Renders a divider; other fields ignored. */
  rule?: boolean
}

export interface MenuAnchor {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ anchor, onClose }: { anchor: MenuAnchor; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: anchor.x, top: anchor.y })

  // Keep the menu inside the viewport regardless of where the click landed.
  useLayoutEffect(() => {
    const box = menu.current?.getBoundingClientRect()
    if (!box) return
    setAt({
      left: Math.min(anchor.x, window.innerWidth - box.width - 8),
      top: Math.min(anchor.y, window.innerHeight - box.height - 8),
    })
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className={styles.backdrop} onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className={styles.menu} ref={menu} style={at} role="menu">
        {anchor.items.map((item, i) =>
          item.rule ? (
            <div key={i} className={styles.rule} />
          ) : (
            <button
              key={i}
              className={`${styles.item} ${item.danger ? styles.danger : ''}`}
              disabled={item.disabled}
              role="menuitem"
              onClick={() => {
                onClose()
                item.onSelect?.()
              }}
            >
              {item.Icon && <item.Icon size={14} />}
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  )
}
