import type { MouseEvent, ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
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
      <div
        role="tablist"
        aria-label="Terminals"
        data-gharargah-session-terminal-tabs=""
        className="flex h-8 min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto"
      >
        {items.map(item => {
          const selected = item.id === activeId
          const closable = canClose(item.id)
          return (
            <div
              key={item.id}
              data-gharargah-session-terminal-tab-shell={item.id}
              data-gharargah-session-tab-pill=""
              data-active={selected ? "" : undefined}
              className={cn(
                "group relative flex max-w-40 min-w-20 shrink-0 items-center gap-0.5 rounded-[0.65rem] border px-1.5",
                selected
                  ? "border-border/80 bg-card/75 text-foreground shadow-sm"
                  : "border-transparent bg-muted/30 text-foreground/70 hover:border-border/60 hover:bg-muted/55 hover:text-foreground",
              )}
              onMouseDown={(event: MouseEvent<HTMLDivElement>) => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
              }}
              onAuxClick={(event: MouseEvent<HTMLDivElement>) => {
                if (event.button !== 1) return
                event.preventDefault()
                event.stopPropagation()
                if (closable) onClose(item.id)
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-gharargah-session-terminal-tab={item.id}
                data-active={selected ? "" : undefined}
                data-state={selected ? "active" : "inactive"}
                title={item.label}
                className="min-w-0 flex-1 truncate px-1 text-left font-mono text-2xs font-medium outline-none focus-visible:underline focus-visible:underline-offset-4"
                onClick={() => onActiveChange(item.id)}
              >
                <span className="truncate">{item.label}</span>
              </button>
              <button
                type="button"
                aria-label={`Close ${item.label}`}
                title={`Close ${item.label}`}
                data-gharargah-session-terminal-tab-close={item.id}
                data-gharargah-close-session-terminal={item.id}
                disabled={!closable}
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                  closable ? "opacity-70 hover:opacity-100" : "pointer-events-none opacity-0",
                )}
                onPointerDown={event => event.stopPropagation()}
                onClick={(event: MouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation()
                  if (closable) onClose(item.id)
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <div className="flex shrink-0 items-center">
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
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-transparent",
        className,
      )}
      aria-label="Session terminals"
    >
      <SessionHeaderChromePortal active={headerActive}>
        {tabBar}
      </SessionHeaderChromePortal>
      {!headerActive ? (
        <div
          data-gharargah-liquid-glass="chrome"
          className="flex h-9 shrink-0 items-center gap-1 border-b border-transparent bg-transparent px-2"
        >
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
              {selected ? item.content : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
