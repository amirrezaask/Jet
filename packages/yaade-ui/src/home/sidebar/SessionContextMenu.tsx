import type { ReactNode } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import type { SidebarSession } from "./types.js"

export type SessionSidebarActions = {
  onOpen: (session: SidebarSession) => void
  onRename?: (session: SidebarSession) => void
  onMarkRead?: (session: SidebarSession) => void
  onArchive?: (session: SidebarSession) => void
}

function SessionMenuItems({
  session,
  actions,
  Item,
  Separator,
}: {
  session: SidebarSession
  actions: SessionSidebarActions
  Item: typeof ContextMenuItem
  Separator: typeof ContextMenuSeparator
}) {
  return (
    <>
      <Item onSelect={() => actions.onOpen(session)}>Open</Item>
      {actions.onRename ? (
        <Item onSelect={() => actions.onRename?.(session)}>Rename</Item>
      ) : null}
      {session.unreadCount > 0 && actions.onMarkRead ? (
        <>
          <Separator />
          <Item onSelect={() => actions.onMarkRead?.(session)}>Mark as read</Item>
        </>
      ) : null}
      {actions.onArchive && !session.archivedAt ? (
        <>
          <Separator />
          <Item
            onSelect={() => actions.onArchive?.(session)}
            data-yaade-sidebar-session-archive=""
          >
            Archive
          </Item>
        </>
      ) : null}
    </>
  )
}

export function SessionContextMenu({
  session,
  actions,
  children,
}: {
  session: SidebarSession
  actions: SessionSidebarActions
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent data-yaade-session-context-menu="">
        <SessionMenuItems
          session={session}
          actions={actions}
          Item={ContextMenuItem}
          Separator={ContextMenuSeparator}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function SessionDropdownMenu({
  session,
  actions,
  trigger,
}: {
  session: SidebarSession
  actions: SessionSidebarActions
  trigger: ReactNode
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" data-yaade-session-dropdown-menu="">
        <SessionMenuItems
          session={session}
          actions={actions}
          Item={DropdownMenuItem as typeof ContextMenuItem}
          Separator={DropdownMenuSeparator as typeof ContextMenuSeparator}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
