import { lazy, Suspense, type ReactNode } from "react"
import type { PanelId, PanelView } from "@yaade/shared"
import { fileUriToPath, pathToFileUri } from "@yaade/shared"
import type { WorkspaceFolder, WorkspaceService } from "@yaade/workspace"
import type { LspStatus } from "@yaade/lsp/status"
import {
  TerminalSessionModal,
  formatSessionHeaderTitle,
  ModalEditorPane,
  NotificationBell,
  PanelBody,
  ProjectTodosPane,
  type SessionDialogMode,
  type TabStore,
  type TabTypeRegistry,
  type ModalEditorBuffer,
  type OpenInAppId,
  type NotificationBellProps,
} from "@yaade/ui"
import { SessionTerminalWorkspacePane } from "./SessionTerminalWorkspacePane.js"
import {
  terminalCwdForTab,
  terminalSessionForTab,
} from "./tabs/terminal-session.js"
import {
  openPathFromTerminal,
  resolvePathUnderRoot,
} from "./editor/code-editor-service.js"
import { ensureMonacoWorkersConfigured } from "./editor/monaco-workers.js"

const GitWorkspace = lazy(async () => {
  await ensureMonacoWorkersConfigured()
  return import("@yaade/ui/git")
})

export type SessionPaneHostProps = {
  sessionTabId: string
  panelId: PanelId
  focused: boolean
  mode: SessionDialogMode
  onModeChange: (mode: SessionDialogMode) => void
  titleTick: number
  editorChromeTick: number
  gitBranch: string | null
  onGitBranchChange: (branch: string | null) => void
  gitFocusPath: string | null
  workspace: WorkspaceService
  tabStore: TabStore
  tabTypeRegistry: TabTypeRegistry
  folderForSessionTab: (tabId: string | null) => WorkspaceFolder | null
  editorBuffers: ModalEditorBuffer[]
  editorActiveTabId: string | null
  editorPanelId: PanelId | null
  modalMonacoEditorHandle: PanelView | null
  lspStatus: LspStatus
  projectSearchOpen: boolean
  onProjectSearchOpenChange: (open: boolean) => void
  notificationCounts: NotificationBellProps["counts"]
  onOpenNotifications: () => void
  onResumeArchived: (tabId: string) => void
  onHideSession: (panelId: PanelId, tabId: string) => void
  onOpenInApp: (rootUri: string, appId: OpenInAppId) => void
  onActivateBuffer: (tabId: string) => void
  onCloseBuffer: (tabId: string) => void
  onOpenSearchItem: (item: {
    fileUri: string
    line: number
    column: number
  }) => void
  openFileInEditor: (
    uri: string,
    path: string,
    line?: number,
    column?: number,
  ) => void
  openFileInEditorRef: {
    current: (
      uri: string,
      path: string,
      line?: number,
      column?: number,
      endLine?: number,
      endColumn?: number,
    ) => void
  }
  activeTheme: unknown
  headerEnd?: ReactNode
}

function agentIdOf(
  tabId: string,
): "claude" | "codex" | "cursor" | "opencode" | "grok" | null {
  const id = terminalSessionForTab(tabId)?.agentId
  return id === "claude" ||
    id === "codex" ||
    id === "cursor" ||
    id === "opencode" ||
    id === "grok"
    ? id
    : null
}

export function SessionPaneHost(props: SessionPaneHostProps) {
  const {
    sessionTabId,
    panelId,
    focused,
    mode,
    onModeChange,
    titleTick,
    editorChromeTick,
    gitBranch,
    onGitBranchChange,
    gitFocusPath,
    workspace,
    tabStore,
    tabTypeRegistry,
    folderForSessionTab,
    editorBuffers,
    editorActiveTabId,
    editorPanelId,
    modalMonacoEditorHandle,
    projectSearchOpen,
    onProjectSearchOpenChange,
    notificationCounts,
    onOpenNotifications,
    onResumeArchived,
    onHideSession,
    onOpenInApp,
    onActivateBuffer,
    onCloseBuffer,
    onOpenSearchItem,
    openFileInEditor,
    openFileInEditorRef,
    activeTheme,
  } = props

  void titleTick
  void editorChromeTick

  const session = terminalSessionForTab(sessionTabId)
  const canShowAgent = Boolean(session?.agentId && session?.launchCommand)
  const rootUri = terminalCwdForTab(sessionTabId)
  const project = workspace.folders.find(f => f.root.uri === rootUri)?.root.name

  const title = (() => {
    if (mode === "editor") {
      const fileLabel = editorActiveTabId
        ? (workspace.fileForUri(editorActiveTabId)?.name ??
          tabStore.title(editorActiveTabId))
        : "Editor"
      return formatSessionHeaderTitle(project, fileLabel)
    }
    if (mode === "agent") {
      return (
        session?.customLabel ??
        session?.agentTitle ??
        workspace.tabRegistry.get(sessionTabId)?.label ??
        "Agent"
      )
    }
    if (mode === "git") return formatSessionHeaderTitle(project, "Git")
    if (mode === "todos") return formatSessionHeaderTitle(project, "TODOs")
    const label =
      workspace.tabRegistry.get(sessionTabId)?.label ?? "Terminal"
    return formatSessionHeaderTitle(project, label)
  })()

  const showLiveEditor = focused && mode === "editor"

  return (
    <TerminalSessionModal
      key={sessionTabId}
      sessionId={sessionTabId}
      open
      presentation="inline"
      embedded
      panelId={panelId}
      tabStore={tabStore}
      paneFocused={focused}
      onHideSession={() => onHideSession(panelId, sessionTabId)}
      headerEnd={
        props.headerEnd ?? (
          <NotificationBell
            counts={notificationCounts}
            onClick={onOpenNotifications}
            className="size-7 shrink-0 rounded-md"
          />
        )
      }
      onOpenChange={() => {}}
      title={title}
      gitBranch={gitBranch}
      projectRootUri={rootUri || null}
      projectName={canShowAgent ? null : (project ?? null)}
      launchCommand={session?.launchCommand ?? null}
      status={session?.status ?? null}
      archivedAt={session?.archivedAt ?? null}
      onResumeArchived={() => onResumeArchived(sessionTabId)}
      mode={mode}
      showAgentTab={canShowAgent}
      agentId={agentIdOf(sessionTabId)}
      onModeChange={next => {
        if (next === "agent" && !canShowAgent) return
        onModeChange(next)
      }}
      onOpenInApp={onOpenInApp}
      agent={
        canShowAgent ? (
          <div
            key={`${sessionTabId}:${session?.archivedAt ?? "active"}`}
            className="h-full min-h-0 min-w-0"
            data-yaade-session-pane="agent"
          >
            <PanelBody
              panelId={panelId}
              view={
                {
                  kind: "tabs",
                  activeTabId: sessionTabId,
                  tabIds: [sessionTabId],
                } as PanelView
              }
              store={tabStore}
              registry={tabTypeRegistry}
              focused={focused && mode === "agent"}
            />
          </div>
        ) : null
      }
      editor={
        <ModalEditorPane
          buffers={editorBuffers}
          activeTabId={editorActiveTabId}
          workspace={workspace}
          lspStatus={props.lspStatus}
          headerActive={focused && mode === "editor"}
          getSearchFolders={() => {
            const folder = folderForSessionTab(sessionTabId)
            if (folder) return [folder]
            const active = workspace.manager.activeFolder
            return active ? [active] : workspace.folders
          }}
          onActivateBuffer={onActivateBuffer}
          onCloseBuffer={onCloseBuffer}
          projectSearchOpen={projectSearchOpen}
          onProjectSearchOpenChange={onProjectSearchOpenChange}
          onOpenSearchItem={onOpenSearchItem}
        >
          {showLiveEditor && editorPanelId && modalMonacoEditorHandle ? (
            <PanelBody
              panelId={editorPanelId}
              view={modalMonacoEditorHandle}
              store={tabStore}
              registry={tabTypeRegistry}
              focused
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {mode === "editor" && !focused
                ? "Focus this pane to edit"
                : "Open a file to start editing"}
            </div>
          )}
        </ModalEditorPane>
      }
      terminal={
        <SessionTerminalWorkspacePane
          sessionTabId={sessionTabId}
          theme={activeTheme as never}
          active={mode === "terminal"}
          headerActive={focused && mode === "terminal"}
          primaryTerminal={
            session?.agentId ? null : (
              <PanelBody
                panelId={panelId}
                view={
                  {
                    kind: "tabs",
                    activeTabId: sessionTabId,
                    tabIds: [sessionTabId],
                  } as PanelView
                }
                store={tabStore}
                registry={tabTypeRegistry}
                focused={focused && mode === "terminal"}
              />
            )
          }
          onOpenPath={(rawPath, line, column) => {
            const cwd = terminalCwdForTab(sessionTabId)
            const cwdPath = fileUriToPath(cwd)
            const fullPath = resolvePathUnderRoot(cwdPath, rawPath)
            const fileUri = pathToFileUri(fullPath)
            if (!workspace.resolveRootUriForFile(fileUri)) return
            openPathFromTerminal(
              openFileInEditorRef.current,
              cwdPath,
              rawPath,
              line,
              column,
            )
          }}
        />
      }
      git={
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Loading Git…
            </div>
          }
        >
          <GitWorkspace
            rootUri={rootUri || null}
            theme={activeTheme as never}
            focusPath={gitFocusPath}
            onBranchChange={onGitBranchChange}
            onOpenFile={relativePath => {
              if (!rootUri) return
              const rootPath = fileUriToPath(rootUri).replace(/[/\\]+$/, "")
              const fullPath = `${rootPath}/${relativePath.replace(/^[/\\]+/, "")}`
              openFileInEditor(pathToFileUri(fullPath), fullPath)
            }}
          />
        </Suspense>
      }
      todos={(() => {
        const folder = workspace.folders.find(f => f.root.uri === rootUri)
        const projectId = folder?.root.path ?? rootUri ?? ""
        const projectName = folder?.root.name ?? "Project"
        return (
          <ProjectTodosPane projectId={projectId} projectName={projectName} />
        )
      })()}
    />
  )
}
