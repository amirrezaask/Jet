import { createElement } from "react"
import { basename } from "@gharargah/shared"
import type { TabType } from "@gharargah/ui"
import { EditorTabHost } from "@gharargah/ui"
import type { TabContributorDeps } from "./deps.js"

import type { KnownTabKind } from "@gharargah/workspace"

export const EDITOR_TAB_TYPE_ID: KnownTabKind = "editor"

export type EditorTabState = { fileUri: string }

export function createEditorTabType(deps: TabContributorDeps): TabType<EditorTabState> {
  const { workspace } = deps
  return {
    id: EDITOR_TAB_TYPE_ID,
    keepMounted: false,
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
