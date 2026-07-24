import { memo, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js"
import { cn } from "../../lib/utils.js"
import type { AgentConnectionState, AgentUsage } from "@gharargah/agents"
import { UsageMeter } from "./UsageMeter.js"

export const ChatHeader = memo(function ChatHeader(props: {
  activeThreadTitle: string
  activeProjectName?: string | null
  activeModelLabel?: string | null
  connection?: AgentConnectionState | null
  usage?: AgentUsage | null
  inspector?: ReactNode
  className?: string
}) {
  const {
    activeThreadTitle,
    activeProjectName,
    activeModelLabel,
    connection,
    usage,
    inspector,
    className,
  } = props
  return (
    <div
      data-chat-header="true"
      className={cn(
        "@container/header-actions flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-background px-4 py-2.5 sm:gap-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
        <Tooltip>
          <TooltipTrigger asChild>
            <h2
              aria-label={activeThreadTitle}
              className="min-w-0 truncate text-sm font-medium text-foreground"
            >
              {activeThreadTitle}
            </h2>
          </TooltipTrigger>
          <TooltipContent side="bottom">{activeThreadTitle}</TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground">
          {activeProjectName ? <span className="truncate">{activeProjectName}</span> : null}
          {activeProjectName && activeModelLabel ? (
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
          ) : null}
          {activeModelLabel ? (
            <span className="truncate" data-chat-header-model="true">
              {activeModelLabel}
            </span>
          ) : null}
          {connection?.status ? (
            <span className="capitalize">{connection.status.replaceAll("_", " ")}</span>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {usage ? <UsageMeter usage={usage} compact /> : null}
        {inspector}
      </div>
    </div>
  )
})
