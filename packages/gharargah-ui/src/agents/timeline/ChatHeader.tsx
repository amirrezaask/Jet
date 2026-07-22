import { memo } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js"
import { cn } from "../../lib/utils.js"

export const ChatHeader = memo(function ChatHeader(props: {
  activeThreadTitle: string
  activeProjectName?: string | null
  className?: string
}) {
  const { activeThreadTitle, activeProjectName, className } = props
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
        {activeProjectName ? (
          <p className="truncate text-xs text-muted-foreground">{activeProjectName}</p>
        ) : null}
      </div>
    </div>
  )
})
