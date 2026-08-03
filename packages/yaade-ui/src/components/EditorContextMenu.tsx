import { useEffect, useState } from "react"
import type { MonacoEditorHandle } from "@yaade/monaco"
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
  open: _open,
  view,
  lspAvailable,
  hasLspPlugin,
  executeCommand,
}: {
  open: boolean
  view: MonacoEditorHandle | null
  lspAvailable: boolean
  hasLspPlugin: boolean
  executeCommand: (name: string) => Promise<void>
}) {
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
          <KeyBindingKbd binding={formatKeyBinding("Shift-Alt-F")} className="ml-auto" />
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        <ContextMenuItem onSelect={() => void executeCommand("editor.find")}>
          Find
          <KeyBindingKbd binding={formatKeyBinding("Mod-f")} className="ml-auto" />
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void executeCommand("workspace.saveFile")}>
          Save
          <KeyBindingKbd binding={formatKeyBinding("Mod-s")} className="ml-auto" />
        </ContextMenuItem>
      </ContextMenuGroup>
    </ContextMenuContent>
  )
}
