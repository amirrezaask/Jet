import { createElement } from "react"
import { basename } from "@jet/shared"
import type { TabType } from "@jet/ui"
import { EditorTabHost } from "@jet/ui"
import type { TabContributorDeps } from "./deps.js"

export const EDITOR_TAB_TYPE_ID = "editor"

export type EditorTabState = { fileUri: string }

export function createEditorTabType(deps: TabContributorDeps): TabType<EditorTabState> {
  const { workspace } = deps
  return {
    id: EDITOR_TAB_TYPE_ID,
    title: state => {
      const file = workspace.fileForUri(state.fileUri)
      return file?.name ?? basename(state.fileUri) ?? state.fileUri
    },
    dirty: state => workspace.fileForUri(state.fileUri)?.isDirty ?? false,
    render: (instance, ctx) =>
      createElement(EditorTabHost, {
        panelId: ctx.panelId,
        fileUri: instance.state.fileUri,
        workspace,
        theme: deps.getTheme(),
        resolveLspClient: deps.resolveLspClient,
        lspRevision: deps.getLspRevision(),
        executeCommand: deps.executeCommand,
        runKeyBinding: deps.runKeyBinding,
        keymapBindings: deps.getKeymapBindings(),
        userExtensions: deps.getUserExtensions(),
        keymapRevision: deps.getKeymapRevision(),
        keymapContext: deps.getKeymapContext(),
        onEditorFocusChange: deps.onEditorFocusChange,
        onEditorSelectionChange: deps.onEditorSelectionChange,
        onLspAttachFailed: deps.onLspAttachFailed,
        onProblemsChange: deps.onProblemsChange,
        autoFocus: ctx.focused && ctx.isActive,
      }),
  }
}
