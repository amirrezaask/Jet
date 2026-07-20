import { cloneElement, useState, type MouseEvent, type ReactElement } from "react"
import { Plus, SquareTerminal } from "lucide-react"
import { ClaudeAI, CursorIcon, OpenAI, type Icon } from "../agents/composer/Icons.js"
import { Button } from "../components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js"
import type { TerminalAgentShortcut } from "../tabs/TerminalExplorerTab.js"
import { cn } from "@/lib/utils.js"

export const SESSION_AGENT_SHORTCUTS: Array<TerminalAgentShortcut & { Icon: Icon }> = [
  { id: "codex", label: "Codex", command: "codex", Icon: OpenAI },
  { id: "claude", label: "Claude", command: "claude", Icon: ClaudeAI },
  { id: "cursor", label: "Cursor Agent", command: "cursor-agent", Icon: CursorIcon },
]

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
  // Controlled open so Tauri e2e synthetic `.click()` still opens the menu
  // (Radix otherwise requires real pointerdown).
  const [open, setOpen] = useState(false)

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
        className="[WebkitAppRegion:no-drag]"
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => onNewTerminal(rootUri)}>
            <SquareTerminal className="size-4" />
            Terminal
          </DropdownMenuItem>
          {SESSION_AGENT_SHORTCUTS.map(shortcut => (
            <DropdownMenuItem
              key={shortcut.id}
              onSelect={() => onLaunchAgentTerminal(rootUri, shortcut)}
            >
              <shortcut.Icon className="size-4" />
              {shortcut.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
