import 'react'

declare module 'react' {
  interface InputHTMLAttributes<T> {
    /** Folder-select input — the one folder-shaped affordance non-Chromium browsers have. */
    webkitdirectory?: string
  }
}
