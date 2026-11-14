import { create } from 'zustand'
import type { EditorSurface } from '@/editor/EditorSurface'

/**
 * Holds the live editor surface so chrome outside the document pane — the undo and
 * redo buttons, the floating toolbar and the inspector — can drive it
 * through the port rather than reaching into the DOM.
 */
interface EditorState {
  surface: EditorSurface | null
  canUndo: boolean
  canRedo: boolean
  /** Opens the document pane's file picker — the mobile bar has no input of its own. */
  requestImage: (() => void) | null
  attach: (surface: EditorSurface | null) => void
  setRequestImage: (open: (() => void) | null) => void
  syncHistory: () => void
}

export const useEditor = create<EditorState>((set, get) => ({
  surface: null,
  canUndo: false,
  canRedo: false,
  requestImage: null,
  attach: (surface) => set({ surface, canUndo: false, canRedo: false }),
  setRequestImage: (requestImage) => set({ requestImage }),
  syncHistory: () => {
    const { surface } = get()
    set({ canUndo: surface?.canUndo ?? false, canRedo: surface?.canRedo ?? false })
  },
}))
