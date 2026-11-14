import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { tags } from '@lezer/highlight'

/**
 * CodeMirror 6 — a code editor, not the WYSIWYG engine. It renders the source
 * pane and the `site.css` editor; the document itself is always the contenteditable
 * surface.
 */

export type CodeLanguage = 'html' | 'css'

/** Colours come from the app tokens so the pane follows the theme with no JS. */
const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    color: 'var(--fg-mid)',
    backgroundColor: 'var(--bg-source)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.7',
    overflow: 'auto',
  },
  '.cm-content': { padding: '10px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-source)',
    border: 'none',
    color: 'var(--fg-ghost)',
    paddingRight: '4px',
  },
  '.cm-activeLine': { backgroundColor: 'var(--hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg-dim)' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-wash-strong)',
  },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-wash)',
    outline: '1px solid var(--accent-edge)',
  },
})

const highlight = HighlightStyle.define([
  { tag: tags.tagName, color: 'var(--accent-ink)' },
  { tag: tags.attributeName, color: 'var(--ok)' },
  { tag: [tags.attributeValue, tags.string], color: 'var(--fg-body)' },
  { tag: tags.comment, color: 'var(--fg-faint)', fontStyle: 'italic' },
  { tag: [tags.angleBracket, tags.punctuation], color: 'var(--fg-faint)' },
  { tag: [tags.propertyName, tags.definitionKeyword], color: 'var(--accent-ink)' },
  { tag: [tags.number, tags.unit, tags.atom], color: 'var(--danger)' },
  { tag: tags.keyword, color: 'var(--accent)' },
])

const LANGUAGES: Record<CodeLanguage, () => Extension> = { html, css }

export interface CodeEditorProps {
  value: string
  language: CodeLanguage
  onChange?: (value: string) => void
  onBlur?: () => void
  readOnly?: boolean
  className?: string
}

export function CodeEditor({
  value,
  language,
  onChange,
  onBlur,
  readOnly = false,
  className,
}: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Kept in a ref so changing the handler never rebuilds the editor.
  const handlers = useRef({ onChange, onBlur })
  handlers.current = { onChange, onBlur }

  useEffect(() => {
    const node = host.current
    if (!node) return

    const editor = new EditorView({
      parent: node,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          history(),
          bracketMatching(),
          indentOnInput(),
          syntaxHighlighting(highlight),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          LANGUAGES[language](),
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          theme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) handlers.current.onChange?.(update.state.doc.toString())
            if (update.focusChanged && !update.view.hasFocus) handlers.current.onBlur?.()
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // Rebuilding on language or readOnly is fine; `value` is synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, readOnly])

  // Push external changes in — but never while they match, or typing would fight
  // the reparse and the cursor would jump every keystroke.
  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    })
  }, [value])

  return <div className={className} ref={host} />
}
