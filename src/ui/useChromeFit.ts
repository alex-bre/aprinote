import { useEffect, useState } from 'react'
import type { Mode } from '@/store/sessionStore'

const SIDEBAR = 252
const RAIL = 46
/** The doc pane's comfortable width. Its hard CSS floor is 380px — the budget
    sheds chrome before the reading column is squeezed down to it. */
const DOC = 440
const SOURCE = 340
const INSPECTOR = 268

/**
 * Below this the layout stops shedding chrome and changes shape: the sidebar
 * becomes a drawer, the header collapses to one row, and formatting moves to a
 * docked toolbar.
 */
export const MOBILE = 760

interface ChromeFit {
  sidebar: boolean
  inspector: boolean
  mobile: boolean
}

/**
 * One width budget for every mode: shed the inspector first, then collapse the
 * sidebar to the rail. Deliberately not per-mode breakpoints.
 */
function chromeFit(width: number, mode: Mode, wantsInspector: boolean): ChromeFit {
  const content = DOC + (mode === 'split' ? SOURCE : 0)
  const wants = wantsInspector && mode !== 'preview'
  const need = (nav: number, inspector: boolean) => nav + content + (inspector ? INSPECTOR : 0)

  // On a phone neither is inline at all — the sidebar is a drawer over the page.
  if (width < MOBILE) return { sidebar: false, inspector: false, mobile: true }

  if (need(SIDEBAR, wants) <= width) return { sidebar: true, inspector: wants, mobile: false }
  if (need(SIDEBAR, false) <= width) return { sidebar: true, inspector: false, mobile: false }
  if (need(RAIL, wants) <= width) return { sidebar: false, inspector: wants, mobile: false }
  return { sidebar: false, inspector: false, mobile: false }
}

export function useChromeFit(mode: Mode, wantsInspector: boolean, wantsSidebar: boolean): ChromeFit {
  const [width, setWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fit = chromeFit(width, mode, wantsInspector)
  return { ...fit, sidebar: fit.sidebar && wantsSidebar }
}
