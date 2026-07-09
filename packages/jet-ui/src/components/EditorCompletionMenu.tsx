import { memo, useCallback, useEffect, useState } from "react"
import { createPortal } from "react-dom"
import type { EditorView } from "@codemirror/view"
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  selectedCompletionIndex,
  setSelectedCompletion,
  type Completion,
} from "@codemirror/autocomplete"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import { cn } from "@/lib/utils.js"

export const EditorCompletionMenu = memo(function EditorCompletionMenu(props: {
  view: EditorView | null
}) {
  const { view } = props
  const [revision, setRevision] = useState(0)
  const [anchor, setAnchor] = useState({ left: 0, top: 0 })

  const bump = useCallback(() => setRevision(r => r + 1), [])

  useEffect(() => {
    if (!view) return
    const onInput = () => bump()
    const onKeyDown = () => bump()
    view.dom.addEventListener("input", onInput)
    view.dom.addEventListener("keydown", onKeyDown)
    return () => {
      view.dom.removeEventListener("input", onInput)
      view.dom.removeEventListener("keydown", onKeyDown)
    }
  }, [view, bump])

  const open = view != null && completionStatus(view.state) === "active"
  const options = open && view ? currentCompletions(view.state) : []
  const selected = open && view ? selectedCompletionIndex(view.state) : null

  useEffect(() => {
    if (!view || !open) return
    const rect = view.coordsAtPos(view.state.selection.main.head)
    if (rect) setAnchor({ left: rect.left, top: rect.bottom })
  }, [view, open, revision])

  const applyOption = useCallback(
    (_option: Completion, index: number) => {
      if (!view) return
      view.dispatch({ effects: setSelectedCompletion(index) })
      acceptCompletion(view)
    },
    [view],
  )

  if (!open || !view || options.length === 0) return null

  return createPortal(
    <ContextMenu open modal={false}>
      <ContextMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: anchor.left, top: anchor.top }}
        />
      </ContextMenuTrigger>
      <ContextMenuContent
        className="max-h-80 min-w-64 font-mono text-sm"
        onCloseAutoFocus={event => event.preventDefault()}
        style={{ position: "fixed", left: anchor.left, top: anchor.top }}
      >
        {options.map((option, index) => (
          <ContextMenuItem
            key={`${option.label}:${option.detail ?? index}`}
            className={cn(index === selected && "bg-accent text-accent-foreground")}
            onSelect={() => applyOption(option, index)}
          >
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {option.detail ? <ContextMenuShortcut>{option.detail}</ContextMenuShortcut> : null}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>,
    document.body,
  )
})
