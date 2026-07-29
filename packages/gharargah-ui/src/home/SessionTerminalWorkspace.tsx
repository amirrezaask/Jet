import type { ReactNode } from "react"
import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js"
import { cn } from "@/lib/utils.js"

export type SessionTerminalItem = {
  id: string
  label: string
  content: ReactNode
}

export type SessionTerminalWorkspaceProps = {
  items: SessionTerminalItem[]
  activeId: string
  onActiveChange: (id: string) => void
  onAdd: () => void
  onCloseActive: () => void
  canCloseActive: boolean
  className?: string
}

/**
 * Session-scoped shell tabs. This is deliberately nested below the four
 * top-level tools so an agent process is never presented as a generic terminal.
 */
export function SessionTerminalWorkspace(
  props: SessionTerminalWorkspaceProps,
) {
  const {
    items,
    activeId,
    onActiveChange,
    onAdd,
    onCloseActive,
    canCloseActive,
    className,
  } = props

  return (
    <section
      data-gharargah-session-terminal-workspace=""
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background",
        className,
      )}
      aria-label="Session terminals"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/15 px-2">
        <Tabs
          value={activeId}
          onValueChange={onActiveChange}
          className="min-w-0 flex-1 overflow-hidden"
        >
          <TabsList
            variant="line"
            aria-label="Terminals"
            data-gharargah-session-terminal-tabs=""
            className="h-9 max-w-full justify-start gap-0 overflow-x-auto"
          >
            {items.map(item => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                data-gharargah-session-terminal-tab={item.id}
                className="h-9 min-w-24 max-w-44 justify-start truncate px-3 font-mono text-xs"
              >
                <span className="truncate">{item.label}</span>
              </TabsTrigger>
            ))}
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
            disabled={!canCloseActive}
            onClick={onCloseActive}
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
