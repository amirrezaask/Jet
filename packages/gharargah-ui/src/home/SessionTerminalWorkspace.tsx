import type { MouseEvent, ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js"
import { cn } from "@/lib/utils.js"
import { SessionHeaderChromePortal } from "./session-header-chrome.js"

export type SessionTerminalItem = {
  id: string
  label: string
  content: ReactNode
}

export type SessionTerminalTabBarProps = {
  items: SessionTerminalItem[]
  activeId: string
  onActiveChange: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  canClose: (id: string) => boolean
  className?: string
}

export type SessionTerminalWorkspaceProps = {
  items: SessionTerminalItem[]
  activeId: string
  onActiveChange: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
  canClose: (id: string) => boolean
  /** When true, terminal tabs render in the session header via portal. */
  headerActive?: boolean
  className?: string
}

/**
 * Session-scoped shell tabs. Mode switch lives in the floating dock;
 * these tabs are for multiple PTYs inside terminal mode.
 */
export function SessionTerminalTabBar(props: SessionTerminalTabBarProps) {
  const {
    items,
    activeId,
    onActiveChange,
    onAdd,
    onClose,
    canClose,
    className,
  } = props

  return (
    <div
      data-gharargah-session-header-tabs="terminal"
      className={cn(
        "flex h-full min-h-8 min-w-0 flex-1 items-center gap-1 overflow-hidden",
        className,
      )}
    >
      <Tabs
        value={activeId}
        onValueChange={onActiveChange}
        className="min-w-0 flex-1 overflow-hidden"
      >
        <TabsList
          variant="line"
          aria-label="Terminals"
          data-gharargah-session-terminal-tabs=""
          className="h-8 max-w-full justify-start gap-0.5 overflow-x-auto bg-transparent p-0"
        >
          {items.map(item => {
            const selected = item.id === activeId
            return (
              <TabsTrigger
                key={item.id}
                value={item.id}
                data-gharargah-session-terminal-tab={item.id}
                data-active={selected ? "" : undefined}
                className={cn(
                  "h-7 min-w-20 max-w-40 justify-start truncate rounded-md border px-2.5 font-mono text-2xs",
                  selected
                    ? "border-border bg-card text-foreground shadow-sm"
                    : "border-transparent text-foreground/70 hover:border-border/60 hover:bg-muted/55 hover:text-foreground",
                )}
                onMouseDown={(event: MouseEvent<HTMLButtonElement>) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onAuxClick={(event: MouseEvent<HTMLButtonElement>) => {
                  if (event.button !== 1) return
                  event.preventDefault()
                  event.stopPropagation()
                  if (canClose(item.id)) onClose(item.id)
                }}
              >
                <span className="truncate">{item.label}</span>
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>
      <div className="flex shrink-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-gharargah-close-session-terminal=""
          aria-label="Close terminal"
          title="Close terminal"
          disabled={!canClose(activeId)}
          onClick={() => onClose(activeId)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-gharargah-new-session-terminal=""
          aria-label="New terminal"
          title="New terminal"
          onClick={onAdd}
          className="text-muted-foreground hover:text-foreground"
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </div>
  )
}

export function SessionTerminalWorkspace(
  props: SessionTerminalWorkspaceProps,
) {
  const {
    items,
    activeId,
    onActiveChange,
    onAdd,
    onClose,
    canClose,
    headerActive = false,
    className,
  } = props

  const tabBar = (
    <SessionTerminalTabBar
      items={items}
      activeId={activeId}
      onActiveChange={onActiveChange}
      onAdd={onAdd}
      onClose={onClose}
      canClose={canClose}
    />
  )

  return (
    <section
      data-gharargah-session-terminal-workspace=""
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
      aria-label="Session terminals"
    >
      <SessionHeaderChromePortal active={headerActive}>
        {tabBar}
      </SessionHeaderChromePortal>
      {!headerActive ? (
        <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/15 px-2">
          {tabBar}
        </div>
      ) : null}

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {items.map(item => {
          const selected = item.id === activeId
          return (
            <div
              key={item.id}
              data-gharargah-session-terminal-pane={item.id}
              data-active={selected ? "" : undefined}
              hidden={!selected}
              aria-hidden={!selected}
              className={cn(
                "absolute inset-0 min-h-0 min-w-0 overflow-hidden",
                selected ? "z-10" : "pointer-events-none z-0",
              )}
            >
              {item.content}
            </div>
          )
        })}
      </div>
    </section>
  )
}
