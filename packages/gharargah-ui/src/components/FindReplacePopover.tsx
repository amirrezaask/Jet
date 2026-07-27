/**
 * Find/replace UI for Monaco — uses Monaco's built-in find controller.
 * Panel popover triggers Monaco find widget via actions.
 */
import { useEffect, useState } from "react"
import type { PanelId } from "@gharargah/shared"
import { Button } from "@/components/ui/button.js"
import { PanelFloatingPopover } from "@/dock/PanelFloatingPopover.js"
import { getEditorView } from "@/tabs/editor-view-registry.js"
import {
  getActiveMonacoEditor,
  triggerFind,
  triggerReplace,
  type MonacoEditorHandle,
} from "@gharargah/monaco"

type FindMode = "find" | "replace" | null

let findModeState: FindMode = null
const listeners = new Set<(mode: FindMode) => void>()

export function openMonacoFind(mode: "find" | "replace"): void {
  findModeState = mode
  for (const l of listeners) l(mode)
  const editor = getActiveMonacoEditor()
  if (!editor) return
  if (mode === "replace") triggerReplace(editor)
  else triggerFind(editor)
}

export function closeMonacoFind(): void {
  findModeState = null
  for (const l of listeners) l(null)
}

export function FindReplacePopover({ panelId }: { panelId: PanelId }) {
  const [mode, setMode] = useState<FindMode>(findModeState)

  useEffect(() => {
    listeners.add(setMode)
    return () => {
      listeners.delete(setMode)
    }
  }, [])

  const editor = getEditorView(panelId) as MonacoEditorHandle | undefined
  const open = Boolean(mode && editor && getActiveMonacoEditor() === editor)

  if (!open || !editor) return null

  return (
    <PanelFloatingPopover
      panelId={panelId}
      open={open}
      corner="top-right"
      onOpenChange={next => {
        if (!next) closeMonacoFind()
      }}
    >
      <div className="flex flex-col gap-2 p-1">
        <p className="text-muted-foreground text-xs">
          {mode === "replace" ? "Replace" : "Find"} — use Monaco find widget (Cmd/Ctrl+F)
        </p>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              triggerFind(editor)
              openMonacoFind("find")
            }}
          >
            Find
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              triggerReplace(editor)
              openMonacoFind("replace")
            }}
          >
            Replace
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => closeMonacoFind()}>
            Close
          </Button>
        </div>
      </div>
    </PanelFloatingPopover>
  )
}
