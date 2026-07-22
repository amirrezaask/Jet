import { useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react"
import { Command, FileSearch, XIcon } from "lucide-react"
import { fileUriToPath, isUntitledUri } from "@gharargah/shared"
import type { WorkspaceService } from "@gharargah/workspace"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import { getEditorCursor, subscribeEditorCursor } from "@/status/editor-cursor-store.js"

export type ModalEditorBuffer = {
  tabId: string
  label: string
  dirty: boolean
}

export type ModalEditorPaneProps = {
  buffers: ModalEditorBuffer[]
  activeTabId: string | null
  workspace: WorkspaceService
  lspStatus: "connected" | "off" | "unavailable"
  onActivateBuffer: (tabId: string) => void
  onCloseBuffer: (tabId: string) => void
  onQuickOpen?: () => void
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
    onCommandPalette,
    children,
  } = props

  const cursorPos = useSyncExternalStore(subscribeEditorCursor, getEditorCursor, getEditorCursor)
  const cursor = cursorPos ?? { line: 1, column: 1 }
  const activeFile = activeTabId ? workspace.fileForUri(activeTabId) : null
  const crumbs = breadcrumbSegments(activeTabId, activeFile?.path ?? null)

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
      </div>

      <div
        data-gharargah-modal-editor-breadcrumbs=""
        className="flex h-8 shrink-0 items-center gap-2 border-b border-border/40 px-3"
      >
        <nav
          aria-label="File path"
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-3xs text-muted-foreground"
        >
          {crumbs.length === 0 ? (
            <span>No file</span>
          ) : (
            crumbs.map((segment, index) => (
              <span key={`${segment}-${index}`}>
                {index > 0 ? <span className="mx-1 opacity-50">/</span> : null}
                <span
                  className={
                    index === crumbs.length - 1 ? "text-foreground/90" : "text-muted-foreground"
                  }
                >
                  {segment}
                </span>
              </span>
            ))
          )}
        </nav>
        <div className="flex shrink-0 items-center gap-0.5">
          {onQuickOpen ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title="Quick open (⌘⇧O)"
              className="text-muted-foreground hover:text-foreground"
              onClick={onQuickOpen}
            >
              <FileSearch data-icon="inline-start" />
              <span className="hidden sm:inline">Quick Open</span>
            </Button>
          ) : null}
          {onCommandPalette ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              title="Command palette (⌘P)"
              className="text-muted-foreground hover:text-foreground"
              onClick={onCommandPalette}
            >
              <Command data-icon="inline-start" />
              <span className="hidden sm:inline">Commands</span>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>

      <div
        data-gharargah-modal-editor-status=""
        className="flex h-7 shrink-0 items-center gap-3 border-t border-border/50 px-3 font-mono text-3xs text-muted-foreground"
      >
        <span data-gharargah-editor-cursor="">
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span className="ml-auto truncate">
          {activeFile?.languageId ?? "plaintext"}
          {activeFile?.isDirty ? " · dirty" : ""}
        </span>
        <span
          data-gharargah-editor-lsp={lspStatus}
          className={
            lspStatus === "connected"
              ? "text-primary"
              : "text-muted-foreground"
          }
        >
          LSP {lspStatus === "connected" ? "on" : lspStatus === "off" ? "off" : "n/a"}
        </span>
      </div>
    </div>
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

function breadcrumbSegments(tabId: string | null, path: string | null): string[] {
  if (!tabId) return []
  if (isUntitledUri(tabId)) return [tabId.replace(/^untitled:/, "Untitled")]
  const abs = path && path.length > 0 ? path : fileUriToPath(tabId)
  const parts = abs.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 5) return parts
  return ["…", ...parts.slice(-4)]
}
