import { Suspense, lazy } from 'react'
import type { CodeEditorProps } from './CodeEditor'

/**
 * CodeMirror is around 400kB of the bundle and only the source pane and the
 * stylesheet editor need it — neither of which most sessions open. Loading it on
 * demand keeps the editor's own startup cost where it belongs.
 */
const CodeEditor = lazy(() =>
  import('./CodeEditor').then((module) => ({ default: module.CodeEditor })),
)

export function LazyCodeEditor(props: CodeEditorProps) {
  return (
    <Suspense fallback={<div className={props.className} />}>
      <CodeEditor {...props} />
    </Suspense>
  )
}
