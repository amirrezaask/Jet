import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react"
import { Command, FileSearch, SearchIcon, XIcon } from "lucide-react"
import type { LspStatus } from "@gharargah/lsp"
import { lspStatusIsActive, lspStatusShortLabel } from "@gharargah/lsp/status"
import { type ListItem, type WorkspaceService } from "@gharargah/workspace"
import { Button } from "@/components/ui/button.js"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable.js"
import { cn } from "@/lib/utils.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { getEditorCursor, subscribeEditorCursor } from "@/status/editor-cursor-store.js"
import { SearchLocationList } from "@/panels/location-list/SearchLocationList.js"

export type ModalEditorBuffer = {
  tabId: string
  label: string
  dirty: boolean
}

export type ModalEditorPaneProps = {
  buffers: ModalEditorBuffer[]
  activeTabId: string | null
  workspace: WorkspaceService
  lspStatus: LspStatus
  onActivateBuffer: (tabId: string) => void
  onCloseBuffer: (tabId: string) => void
  onQuickOpen?: () => void
  projectSearchOpen?: boolean
  onProjectSearchOpenChange?: (open: boolean) => void
  onOpenSearchItem?: (item: ListItem) => void
  onCommandPalette?: () => void
  children: ReactNode
}

export function ModalEditorPane(props: ModalEditorPaneProps) {
  const {
    buffers,
    activeTabId,
    workspace,
    lspStatus,
    onActivateBuffer,
    onCloseBuffer,
    onQuickOpen,
    projectSearchOpen = false,
    onProjectSearchOpenChange,
    onOpenSearchItem,
    onCommandPalette,
    children,
  } = props

  const cursorPos = useSyncExternalStore(subscribeEditorCursor, getEditorCursor, getEditorCursor)
  const cursor = cursorPos ?? { line: 1, column: 1 }
  const activeFile = activeTabId ? workspace.fileForUri(activeTabId) : null

  return (
    <div
      data-gharargah-modal-editor=""
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      <div
        data-gharargah-modal-editor-tabs=""
        role="tablist"
        aria-label="Open buffers"
        onKeyDown={handleBufferTabKeyDown}
        className="flex h-9 shrink-0 items-stretch gap-0 overflow-x-auto border-b bg-muted"
      >
        {buffers.length === 0 ? (
          <p className="flex items-center px-3 text-2xs text-muted-foreground">
            No open buffers — Quick Open a file
          </p>
        ) : (
          buffers.map(buffer => {
            const active = buffer.tabId === activeTabId
            return (
              <div
                key={buffer.tabId}
                data-gharargah-modal-editor-tab={buffer.tabId}
                data-active={active ? "" : undefined}
                className={cn(
                  "group relative flex max-w-48 min-w-0 shrink-0 items-center gap-1 border-r border-border/40 px-2",
                  active
                    ? "bg-background text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onMouseDown={event => {
                  if (event.button === 1) {
                    event.preventDefault()
                    onCloseBuffer(buffer.tabId)
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  className="min-w-0 flex-1 truncate text-left text-2xs font-medium outline-none focus-visible:underline focus-visible:underline-offset-4"
                  onClick={() => onActivateBuffer(buffer.tabId)}
                  title={buffer.label}
                >
                  {buffer.label}
                </button>
                {buffer.dirty ? (
                  <span
                    data-gharargah-buffer-dirty=""
                    className="size-1.5 shrink-0 rounded-full bg-primary"
                    aria-label="Unsaved changes"
                  />
                ) : null}
                <button
                  type="button"
                  aria-label={`Close ${buffer.label}`}
                  className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                  onClick={event => {
                    event.stopPropagation()
                    onCloseBuffer(buffer.tabId)
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </div>
            )
          })
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 px-1">
          {onQuickOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title={`Quick open (${formatKeyBinding("Mod-p")})`}
              className="text-muted-foreground hover:text-foreground"
              onClick={onQuickOpen}
            >
              <FileSearch data-icon="inline-start" />
              <span className="hidden sm:inline">Quick Open</span>
            </Button>
          ) : null}
          {onProjectSearchOpenChange ? (
            <Button
              type="button"
              variant={projectSearchOpen ? "secondary" : "ghost"}
              size="xs"
              aria-pressed={projectSearchOpen}
              title={`Search project (${formatKeyBinding("Mod-Shift-f")})`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onProjectSearchOpenChange(!projectSearchOpen)}
            >
              <SearchIcon data-icon="inline-start" />
              <span className="hidden sm:inline">Search</span>
            </Button>
          ) : null}
          {onCommandPalette ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title={`Command palette (${formatKeyBinding("Mod-Shift-p")})`}
              className="text-muted-foreground hover:text-foreground"
              onClick={onCommandPalette}
            >
              <Command data-icon="inline-start" />
              <span className="hidden sm:inline">Commands</span>
            </Button>
          ) : null}
        </div>
      </div>

      <ResizablePanelGroup
        orientation="horizontal"
        data-gharargah-modal-editor-content-group=""
        className="relative min-h-0 flex-1 overflow-hidden"
      >
        {projectSearchOpen && onOpenSearchItem ? (
          <>
            <ResizablePanel
              id="editor-project-search"
              defaultSize="320px"
              minSize="256px"
              maxSize="45%"
              groupResizeBehavior="preserve-pixel-size"
            >
              <ModalProjectSearch
                workspace={workspace}
                onOpenItem={onOpenSearchItem}
                onDismiss={() => onProjectSearchOpenChange?.(false)}
              />
            </ResizablePanel>
            <ResizableHandle
              id="editor-project-search-resize"
              data-gharargah-editor-project-search-resize=""
              aria-label="Resize project search"
            />
          </>
        ) : null}
        <ResizablePanel id="editor-content" minSize="360px">
          <div
            data-gharargah-modal-editor-content=""
            className="relative h-full min-h-0 min-w-0 overflow-hidden"
          >
            {children}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      <div
        data-gharargah-modal-editor-status=""
        className="flex h-7 shrink-0 items-center gap-3 border-t border-border/50 px-3 font-mono text-3xs text-muted-foreground"
      >
        <span data-gharargah-editor-cursor="">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span
          data-gharargah-editor-language={activeFile?.languageId ?? "plaintext"}
          className="ml-auto truncate"
        >
          {activeFile?.languageId ?? "plaintext"}
          {activeFile?.isDirty ? " · dirty" : ""}
        </span>
        <span
          data-gharargah-editor-lsp={lspStatus}
          className={lspStatusIsActive(lspStatus) ? "text-primary" : "text-muted-foreground"}
        >
          LSP {lspStatusShortLabel(lspStatus)}
        </span>
      </div>
    </div>
  )
}

function ModalProjectSearch({
  workspace,
  onOpenItem,
  onDismiss,
}: {
  workspace: WorkspaceService
  onOpenItem: (item: ListItem) => void
  onDismiss: () => void
}) {
  const listIdRef = useRef("editor-project-search")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const listId = listIdRef.current
    workspace.listStore.create({
      id: listId,
      title: "Search",
      feed: "search",
      items: [],
      searchQuery: "",
      searchCaseSensitive: false,
      searchRegex: false,
      searchFuzzy: false,
      searchLoading: false,
      searchError: null,
    })
    setReady(true)
    return () => {
      workspace.listStore.dispose(listId)
    }
  }, [workspace])

  return (
    <aside
      data-gharargah-editor-project-search=""
      aria-label="Project search"
      className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background"
    >
      <div className="flex h-9 shrink-0 items-center border-b px-2">
        <h2 className="text-xs font-semibold">Search</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close project search"
          className="ml-auto text-muted-foreground"
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {ready ? (
          <SearchLocationList
            listId={listIdRef.current}
            workspace={workspace}
            onOpenItem={onOpenItem}
            onDismiss={onDismiss}
            autoFocus
          />
        ) : null}
      </div>
    </aside>
  )
}

function handleBufferTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
  if (tabs.length === 0) return
  const current = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement))
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? tabs.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
