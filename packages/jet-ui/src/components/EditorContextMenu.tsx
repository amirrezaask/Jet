import { useEffect, useState } from "react"
import type { EditorView } from "@codemirror/view"
import { scheduleCodeActions, applyCodeAction, type LspCodeAction } from "@jet/lsp"
import {
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu.js"
import { KeyBindingKbd } from "./KeyBindingKbd.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { createContextMenuHost } from "./ContextMenuHost.js"

const editorContextMenu = createContextMenuHost()

export const registerEditorContextMenuHandler = editorContextMenu.register
export const showEditorContextMenuAt = editorContextMenu.showAt

export function EditorContextMenu({
  open,
  view,
  lspAvailable,
  hasLspPlugin,
  executeCommand,
}: {
  open: boolean
  view: EditorView | null
  lspAvailable: boolean
  hasLspPlugin: boolean
  executeCommand: (name: string) => Promise<void>
}) {
  const [codeActions, setCodeActions] = useState<LspCodeAction[]>([])
  const [loadingActions, setLoadingActions] = useState(false)

  useEffect(() => {
    if (!open || !view || !lspAvailable) {
      setCodeActions([])
      return
    }
    setLoadingActions(true)
    void scheduleCodeActions(view, true).then(actions => {
      setCodeActions(actions)
      setLoadingActions(false)
    })
  }, [open, view, lspAvailable])

  const hasLsp = lspAvailable && hasLspPlugin && view

  return (
    <ContextMenuContent className="min-w-[12rem]">
      <ContextMenuGroup>
        <ContextMenuItem onSelect={() => void document.execCommand("cut")}>Cut</ContextMenuItem>
        <ContextMenuItem onSelect={() => void document.execCommand("copy")}>Copy</ContextMenuItem>
        <ContextMenuItem onSelect={() => void document.execCommand("paste")}>Paste</ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem
          disabled={!hasLsp}
          onSelect={() => void executeCommand("editor.action.revealDefinition")}
        >
          Go to Definition
          <KeyBindingKbd binding={formatKeyBinding("F12")} className="ml-auto" />
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasLsp}
          onSelect={() => void executeCommand("editor.action.goToReferences")}
        >
          Go to References
          <KeyBindingKbd binding={formatKeyBinding("Shift-F12")} className="ml-auto" />
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasLsp}
          onSelect={() => void executeCommand("editor.action.rename")}
        >
          Rename Symbol
          <KeyBindingKbd binding={formatKeyBinding("F2")} className="ml-auto" />
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!hasLsp}
          onSelect={() => void executeCommand("editor.action.formatDocument")}
        >
          Format Document
          <KeyBindingKbd binding={formatKeyBinding("Shift-Alt-f")} className="ml-auto" />
        </ContextMenuItem>
      </ContextMenuGroup>
      {hasLsp ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuGroup>
            {loadingActions ? (
              <ContextMenuItem disabled>Quick Fix… (loading)</ContextMenuItem>
            ) : codeActions.length === 0 ? (
              <ContextMenuItem disabled>Quick Fix…</ContextMenuItem>
            ) : (
              codeActions.map(action => (
                <ContextMenuItem
                  key={action.title}
                  onSelect={() => {
                    if (view) void applyCodeAction(view, action)
                  }}
                >
                  {action.title}
                </ContextMenuItem>
              ))
            )}
          </ContextMenuGroup>
        </>
      ) : null}
    </ContextMenuContent>
  )
}
