import ace from 'ace-builds'
import 'ace-builds/src-noconflict/ext-language_tools'
import 'ace-builds/src-noconflict/mode-javascript'
import 'ace-builds/src-noconflict/mode-sql'
import 'ace-builds/src-noconflict/theme-github'
import 'ace-builds/src-noconflict/theme-one_dark'
import clsx from 'clsx'
import { useEffect, useRef } from 'react'
import { useResolvedTheme } from '../../lib/prefs'
import { CopyButton } from './copy-button'

export type Lang = 'sql' | 'js'

const MODES: Record<Lang, string> = { js: 'ace/mode/javascript', sql: 'ace/mode/sql' }

type Editor = ReturnType<typeof ace.edit>

interface CodeViewProps {
  value: string
  lang: Lang
  onChange?: (v: string) => void
  readOnly?: boolean
  gutter?: boolean
  minLines?: number
  maxLines?: number
  placeholder?: string
  /** Ctrl/Cmd+Enter — e.g. run the query */
  onCmdEnter?: () => void
  className?: string
}

/** Low-level Ace mount. Prefer CodeBlock (read-only) or CodeEditor (editable). */
export function CodeView({
  value,
  lang,
  onChange,
  readOnly,
  gutter = false,
  minLines,
  maxLines,
  placeholder,
  onCmdEnter,
  className,
}: CodeViewProps) {
  const elRef = useRef<HTMLDivElement | null>(null)
  const edRef = useRef<Editor | null>(null)
  const theme = useResolvedTheme()
  const cb = useRef({ onChange, onCmdEnter })
  cb.current = { onChange, onCmdEnter }

  useEffect(() => {
    const ed = ace.edit(elRef.current!, {
      mode: MODES[lang],
      theme: theme === 'dark' ? 'ace/theme/one_dark' : 'ace/theme/github',
      readOnly: !!readOnly,
      showGutter: gutter,
      minLines,
      maxLines,
      fontSize: 13,
      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
      useWorker: false,
      showPrintMargin: false,
      highlightActiveLine: !readOnly,
      highlightGutterLine: !readOnly,
      tabSize: 2,
      useSoftTabs: true,
      placeholder,
      enableBasicAutocompletion: !readOnly,
      enableLiveAutocompletion: !readOnly,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    ed.setValue(value ?? '', -1)
    ed.on('change', () => cb.current.onChange?.(ed.getValue()))
    ed.commands.addCommand({
      name: 'cmd-enter',
      bindKey: { win: 'Ctrl-Enter', mac: 'Command-Enter' },
      exec: () => cb.current.onCmdEnter?.(),
    })
    ed.renderer.setPadding(12)
    ed.renderer.setScrollMargin(8, 8, 0, 0)
    if (readOnly) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(ed.renderer as any).$cursorLayer.element.style.display = 'none'
    }
    edRef.current = ed
    return () => {
      ed.destroy()
      edRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, readOnly, gutter, minLines, maxLines, theme])

  useEffect(() => {
    const ed = edRef.current
    if (ed && ed.getValue() !== value) ed.setValue(value ?? '', -1)
  }, [value])

  return <div ref={elRef} className={clsx('w-full', className)} />
}

/** Read-only snippet block with highlighting and a copy button. */
export function CodeBlock({ code, lang = 'js', gutter }: { code: string; lang?: Lang; gutter?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-md border border-border bg-code">
      <CodeView value={code} lang={lang} readOnly gutter={gutter} minLines={2} maxLines={80} />
      <CopyButton value={code} label="Snippet" className="absolute right-2 top-2 z-10" />
    </div>
  )
}

/** Editable code area — size it via className (e.g. 'h-40'). */
export function CodeEditor({
  value,
  onChange,
  lang,
  className,
  placeholder,
  onCmdEnter,
}: {
  value: string
  onChange: (v: string) => void
  lang: Lang
  className?: string
  placeholder?: string
  onCmdEnter?: () => void
}) {
  return (
    <div className={clsx('overflow-hidden rounded-md border border-input bg-field focus-within:border-brand', className)}>
      <CodeView value={value} onChange={onChange} lang={lang} gutter placeholder={placeholder} onCmdEnter={onCmdEnter} className="h-full" />
    </div>
  )
}
