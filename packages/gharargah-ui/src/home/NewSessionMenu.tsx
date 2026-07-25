import { cloneElement, useMemo, useState, type MouseEvent, type ReactElement } from "react"
import { Code2, Plus, SquareTerminal } from "lucide-react"
import { isAgentChatEnabled } from "@gharargah/agents"
import { ClaudeAI, CursorIcon, GrokIcon, OpenAI, type Icon } from "../agents/composer/Icons.js"
import { Button } from "../components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import { cn } from "@/lib/utils.js"

export const SESSION_AGENT_SHORTCUTS: Array<TerminalAgentShortcut & { Icon: Icon }> = [
  { id: "codex", label: "Codex", command: "codex", Icon: OpenAI },
  { id: "codex", label: "Codex Agent", driverId: "codex:app-server", Icon: OpenAI },
  { id: "claude", label: "Claude", command: "claude", Icon: ClaudeAI },
  { id: "claude", label: "Claude Agent", driverId: "claude:sdk", Icon: ClaudeAI },
  { id: "opencode", label: "OpenCode", command: "opencode", Icon: Code2 },
  { id: "opencode", label: "OpenCode Agent", driverId: "opencode:acp", Icon: Code2 },
  { id: "cursor", label: "Cursor", command: "cursor-agent", Icon: CursorIcon },
  { id: "cursor-acp", label: "Cursor (ACP)", driverId: "cursor:acp", Icon: CursorIcon },
  { id: "grok", label: "Grok (ACP)", driverId: "grok:acp", Icon: GrokIcon },
]

function isCliShortcut(shortcut: TerminalAgentShortcut): boolean {
  return typeof shortcut.command === "string" && shortcut.command.length > 0
}

function isAgentChatShortcut(shortcut: TerminalAgentShortcut): boolean {
  return typeof shortcut.driverId === "string" && shortcut.driverId.length > 0 && !isCliShortcut(shortcut)
}

/** Visible shortcuts for the current agent-chat feature flag. */
export function visibleSessionShortcuts(): Array<TerminalAgentShortcut & { Icon: Icon }> {
  if (isAgentChatEnabled()) return SESSION_AGENT_SHORTCUTS
  return SESSION_AGENT_SHORTCUTS.filter(isCliShortcut)
}

export type NewSessionMenuProps = {
  rootUri: string
  onNewTerminal: (rootUri: string) => void
  onLaunchAgentTerminal: (rootUri: string, shortcut: TerminalAgentShortcut) => void
  /** Replace default Plus icon trigger (e.g. empty-state dashed card). */
  trigger?: ReactElement<{ onClick?: (e: MouseEvent) => void }>
  align?: "start" | "center" | "end"
  className?: string
}

export function NewSessionMenu(props: NewSessionMenuProps) {
  const {
    rootUri,
    onNewTerminal,
    onLaunchAgentTerminal,
    trigger,
    align = "end",
    className,
  } = props
  // Controlled open keeps programmatic and pointer activation consistent.
  // (Radix otherwise requires real pointerdown).
  const [open, setOpen] = useState(false)

  const { cliShortcuts, agentShortcuts } = useMemo(() => {
    const visible = visibleSessionShortcuts()
    return {
      cliShortcuts: visible.filter(isCliShortcut),
      agentShortcuts: visible.filter(isAgentChatShortcut),
    }
  }, [])

  const openMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(true)
  }

  const resolvedTrigger = trigger ? (
    cloneElement(trigger, {
      onClick: (e: MouseEvent) => {
        trigger.props.onClick?.(e)
        openMenu(e)
      },
    })
  ) : (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      data-gharargah-new-session
      className={cn("shrink-0", className)}
      title="New session"
      aria-label="New session"
      onClick={openMenu}
    >
      <Plus className="size-3.5" />
    </Button>
  )

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{resolvedTrigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={{ top: 42, right: 8, bottom: 8, left: 8 }}
        className="min-w-52 [WebkitAppRegion:no-drag]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-3xs font-medium text-muted-foreground">
            Shell
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onNewTerminal(rootUri)}>
            <SquareTerminal className="size-4" />
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span>Blank session</span>
              <span className="font-mono text-3xs text-muted-foreground">pty</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {cliShortcuts.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-3xs font-medium text-muted-foreground">
                CLIs
              </DropdownMenuLabel>
              {cliShortcuts.map(shortcut => (
                <DropdownMenuItem
                  key={`${shortcut.id}:${shortcut.command ?? shortcut.label}`}
                  onSelect={() => onLaunchAgentTerminal(rootUri, shortcut)}
                >
                  <shortcut.Icon className="size-4" />
                  <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <span>{shortcut.label}</span>
                    <span className="font-mono text-3xs text-muted-foreground">
                      {shortcut.command}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        {agentShortcuts.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-3xs font-medium text-muted-foreground">
                Agent chat
              </DropdownMenuLabel>
              {agentShortcuts.map(shortcut => (
                <DropdownMenuItem
                  key={`${shortcut.id}:${shortcut.driverId ?? shortcut.label}`}
                  onSelect={() => onLaunchAgentTerminal(rootUri, shortcut)}
                >
                  <shortcut.Icon className="size-4" />
                  {shortcut.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
