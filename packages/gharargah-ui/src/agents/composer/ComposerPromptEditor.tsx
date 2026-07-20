import { LexicalComposer, type InitialConfigType } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type EditorState,
} from "lexical"
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type Ref,
} from "react"
import { cn } from "../../lib/utils.js"

export type ComposerPromptEditorHandle = {
  focus: () => void
  clear: () => void
}

type ComposerPromptEditorProps = {
  value: string
  disabled?: boolean
  placeholder?: string
  className?: string
  editorRef?: Ref<ComposerPromptEditorHandle>
  onChange: (value: string) => void
  onCommandKeyDown?: (event: KeyboardEvent) => boolean | void
}

function setEditorPlainText(text: string): void {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  const parts = text.split("\n")
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (part.length > 0) paragraph.append($createTextNode(part))
    if (i < parts.length - 1) paragraph.append($createLineBreakNode())
  }
  root.append(paragraph)
}

function ComposerCommandKeyPlugin(props: {
  onCommandKeyDown?: (event: KeyboardEvent) => boolean | void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      event => {
        if (!event) return false
        if (event.shiftKey) {
          // WKWebView / plain-text beforeinput path is unreliable for Shift+Enter.
          event.preventDefault()
          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) selection.insertLineBreak()
          })
          return true
        }
        const handled = props.onCommandKeyDown?.(event)
        if (handled) {
          event.preventDefault()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, props.onCommandKeyDown])
  return null
}

function ComposerPromptEditorInner({
  value,
  disabled,
  placeholder,
  className,
  editorRef,
  onChange,
  onCommandKeyDown,
}: ComposerPromptEditorProps) {
  const [editor] = useLexicalComposerContext()
  const isApplyingControlledUpdateRef = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useImperativeHandle(
    editorRef,
    () => ({
      focus: () => {
        editor.focus()
      },
      clear: () => {
        editor.update(() => {
          setEditorPlainText("")
        })
      },
    }),
    [editor],
  )

  useEffect(() => {
    editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    editor.getEditorState().read(() => {
      const current = $getRoot().getTextContent()
      if (current === value) return
      isApplyingControlledUpdateRef.current = true
      editor.update(() => {
        setEditorPlainText(value)
        const root = $getRoot()
        const last = root.getLastChild()
        if (last) {
          last.selectEnd()
        }
      })
      isApplyingControlledUpdateRef.current = false
    })
  }, [editor, value])

  const handleEditorChange = useCallback((editorState: EditorState) => {
    if (isApplyingControlledUpdateRef.current) return
    editorState.read(() => {
      onChangeRef.current($getRoot().getTextContent())
    })
  }, [])

  return (
    <div className="relative">
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            className={cn(
              "block max-h-50 min-h-17.5 w-full overflow-y-auto whitespace-pre-wrap wrap-break-word bg-transparent text-[16px] leading-relaxed text-foreground focus:outline-none sm:text-[14px]",
              className,
            )}
            data-testid="composer-editor"
            aria-placeholder={placeholder ?? ""}
            placeholder={<span />}
          />
        }
        placeholder={
          <div className="pointer-events-none absolute inset-0 text-[16px] leading-relaxed text-muted-foreground/35 sm:text-[14px]">
            {placeholder}
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleEditorChange} />
      <ComposerCommandKeyPlugin onCommandKeyDown={onCommandKeyDown} />
      <HistoryPlugin />
    </div>
  )
}

export function ComposerPromptEditor(props: ComposerPromptEditorProps) {
  const initialValueRef = useRef(props.value)
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: "jet-composer-editor",
      editable: !props.disabled,
      onError(error) {
        throw error
      },
      editorState: () => {
        setEditorPlainText(initialValueRef.current)
      },
    }),
    [props.disabled],
  )

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <ComposerPromptEditorInner {...props} />
    </LexicalComposer>
  )
}
