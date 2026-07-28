import type { MouseEvent, ReactNode } from "react"
import { MoreHorizontal, SquareTerminal, X } from "lucide-react"
import {
  ClaudeAI,
  CursorIcon,
  GrokIcon,
  OpenAI,
  OpenCodeIcon,
  type Icon,
} from "../agents/composer/Icons.js"
import { Button } from "@/components/ui/button.js"
import { Card, CardContent, CardHeader } from "@/components/ui/card.js"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import { cn } from "@/lib/utils.js"
import { StatusBadge } from "./StatusBadge.js"
import type { SessionCardModel, SessionProvider } from "./session-card-model.js"

export type SessionCardProps = {
  session: SessionCardModel
  onClick: () => void
  onKill?: () => void
  onReview?: () => void
  onReject?: () => void
  onViewNotifications?: () => void
}

function ProviderGlyph({
  agentId,
}: {
  agentId?: SessionProvider
}) {
  const className = "size-3.5 shrink-0"
  if (!agentId) {
    return <SquareTerminal className={cn(className, "text-muted-foreground")} />
  }
  const IconComp: Icon | null =
    agentId === "claude"
      ? ClaudeAI
      : agentId === "cursor"
        ? CursorIcon
        : agentId === "codex"
          ? OpenAI
          : agentId === "opencode"
            ? OpenCodeIcon
            : agentId === "grok"
              ? GrokIcon
              : null
  if (IconComp) return <IconComp className={className} />
  return <SquareTerminal className={cn(className, "text-muted-foreground")} />
}

function stopCardClick(e: MouseEvent) {
  e.stopPropagation()
}

export function SessionCard(props: SessionCardProps) {
  const { session, onClick, onKill, onReview, onReject, onViewNotifications } =
    props
  const showApprovalActions =
    session.status === "approval" || session.requiresApproval

  const overflow: ReactNode =
    onKill || onViewNotifications ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Session actions"
          data-gharargah-session-card-menu-trigger
          onClick={stopCardClick}
          onPointerDown={stopCardClick}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={{ top: 42, right: 8, bottom: 8, left: 8 }}
        onClick={stopCardClick}
      >
        {onViewNotifications ? (
          <DropdownMenuItem onSelect={onViewNotifications}>
            View notifications
          </DropdownMenuItem>
        ) : null}
        {onKill ? (
          <DropdownMenuItem variant="destructive" onSelect={onKill}>
            <X className="size-4" />
            End session
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  const card = (
    <div
      data-gharargah-terminal-card
      data-gharargah-session-card
      data-gharargah-list-item
      data-status={session.status}
      data-kind={session.kind}
      data-approval={showApprovalActions ? "true" : undefined}
      className="group relative w-full text-left"
    >
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        aria-label={`Open ${session.title}`}
        onClick={onClick}
      />
      <Card
        className={cn(
          "gharargah-home-session-card pointer-events-none flex h-full min-h-[5.5rem] flex-col gap-1.5 border-border bg-card py-2.5",
          "transition-[border-color,box-shadow,background-color]",
          "group-hover:border-primary/50 group-hover:bg-card",
        )}
      >
        <CardHeader className="gap-0 px-3 py-0 [.border-b]:pb-0">
          <div className="flex items-center gap-1.5">
            <ProviderGlyph agentId={session.agentId} />
            <span className="min-w-0 flex-1 truncate text-3xs font-medium tracking-wide text-muted-foreground">
              {session.agentLabel}
            </span>
            <StatusBadge status={session.status} />
            {overflow ? (
              <div className="pointer-events-auto relative z-20">{overflow}</div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-1 px-3 py-0">
          <p className="line-clamp-1 text-sm leading-snug font-medium text-foreground">
            {session.title}
          </p>
          {session.description ? (
            <p className="line-clamp-1 text-3xs leading-snug text-muted-foreground">
              {session.description}
            </p>
          ) : null}
          {showApprovalActions && (onReview || onReject) ? (
            <div
              className="pointer-events-auto relative z-20 mt-auto flex items-center justify-end gap-1.5 pt-1"
              onClick={stopCardClick}
              onPointerDown={stopCardClick}
            >
              {onReject ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-3xs"
                  data-gharargah-session-reject
                  onClick={e => {
                    stopCardClick(e)
                    onReject()
                  }}
                >
                  Reject
                </Button>
              ) : null}
              {onReview ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 border-primary/50 px-2 text-3xs text-primary"
                  data-gharargah-session-review
                  onClick={e => {
                    stopCardClick(e)
                    onReview()
                  }}
                >
                  Review
                </Button>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )

  if (!onKill) return card

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent data-gharargah-terminal-card-menu>
        <ContextMenuItem
          variant="destructive"
          onSelect={onKill}
        >
          <X className="size-4" />
          End session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
