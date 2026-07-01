import { basename } from "@jet/shared"
import type { PanelId, PanelView } from "@jet/shared"
import type { WorkspaceService } from "@jet/workspace"

export function panelTitle(view: PanelView | null, workspace: WorkspaceService): string {
  if (!view || view.kind === "empty") return "Empty"
  switch (view.kind) {
    case "editor": {
      const file = workspace.fileForUri(view.fileUri)
      return file?.name ?? basename(view.fileUri) ?? "Editor"
    }
    case "explorer":
      return "Explorer"
    case "locationlist":
      return "Locations"
    case "output":
      return "Output"
    default:
      return "Panel"
  }
}

export function PanelHeader({
  panelId,
  view,
  workspace,
  focused,
  onClosePanel,
}: {
  panelId: PanelId
  view: PanelView | null
  workspace: WorkspaceService
  focused: boolean
  onClosePanel: (panelId: PanelId) => void
}) {
  const title = panelTitle(view, workspace)
  const dirty =
    view?.kind === "editor" ? workspace.fileForUri(view.fileUri)?.isDirty : false
  const isEditor = view?.kind === "editor"

  return (
    <div
      className="flex h-7 shrink-0 items-center gap-2 border-b border-[var(--jet-border)] bg-[var(--jet-panel-header)] px-2"
      data-panel-id={panelId.id}
    >
      {isEditor ? (
        <span className="min-w-0 flex-1" />
      ) : (
        <span
          className={`min-w-0 flex-1 truncate text-[length:var(--jet-fs-xs)] uppercase tracking-wide ${focused ? "text-[var(--jet-text)]" : "text-[var(--jet-text-muted)]"}`}
        >
          {title}
          {dirty ? " •" : ""}
        </span>
      )}
      <button
        type="button"
        className="shrink-0 text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)] hover:text-[var(--jet-text)]"
        title="Close panel"
        onClick={e => {
          e.stopPropagation()
          onClosePanel(panelId)
        }}
      >
        ×
      </button>
    </div>
  )
}
