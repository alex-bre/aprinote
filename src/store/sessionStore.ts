import { create } from 'zustand'

export type Mode = 'edit' | 'split' | 'preview'
/** The source pane shows the editable fragment, or the whole file. */
export type SourceMode = 'fragment' | 'document'
/**
 * `fit` is the default: the page renders at whatever width the pane actually has,
 * unscaled. The rest are true device widths, scaled to fit.
 */
export type Device = 'fit' | 'desktop' | 'laptop' | 'tablet' | 'mobile'

const MODE_CYCLE: Mode[] = ['edit', 'split', 'preview']

/** Fixed widths. `fit` has none — it is whatever the pane measures. */
export const DEVICE_WIDTH: Record<Exclude<Device, 'fit'>, number> = {
  desktop: 1440,
  laptop: 1280,
  tablet: 834,
  mobile: 390,
}

export function deviceWidth(device: Device, available: number): number {
  return device === 'fit' ? Math.max(240, Math.round(available)) : DEVICE_WIDTH[device]
}

interface SessionState {
  mode: Mode
  sourceMode: SourceMode
  device: Device
  /** User intent. The chrome budget can still force these closed. */
  sidebarOpen: boolean
  /** The mobile drawer, which overlays rather than taking layout width. */
  drawerOpen: boolean
  inspectorOpen: boolean
  expanded: Record<string, boolean>

  setMode: (mode: Mode) => void
  /** Edit → HTML → View, the phone header's single mode control. */
  cycleMode: () => void
  setSourceMode: (mode: SourceMode) => void
  setDevice: (device: Device) => void
  toggleSidebar: () => void
  setDrawer: (open: boolean) => void
  toggleInspector: () => void
  toggleFolder: (path: string) => void
  expandFolder: (path: string) => void
}

export const useSession = create<SessionState>((set) => ({
  mode: 'edit',
  sourceMode: 'fragment',
  device: 'fit',
  sidebarOpen: true,
  drawerOpen: false,
  inspectorOpen: true,
  expanded: {},

  setMode: (mode) => set({ mode }),
  cycleMode: () => set((s) => ({ mode: MODE_CYCLE[(MODE_CYCLE.indexOf(s.mode) + 1) % 3] })),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  setDevice: (device) => set({ device }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  toggleFolder: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
  expandFolder: (path) => set((s) => ({ expanded: { ...s.expanded, [path]: true } })),
}))
