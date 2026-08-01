import {
  Bot,
  Code2,
  GitBranch,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react"
import type { ComponentType, SVGProps } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js"
import { cn } from "@/lib/utils.js"
import { formatKeyBinding } from "@/lib/format-key.js"
import { sessionProviderIcon } from "./provider-icons.js"
import type { SessionProvider } from "./session-card-model.js"
import type { SessionDialogMode } from "./TerminalSessionModal.js"

export type SessionModeDockProps = {
  mode: SessionDialogMode
  onModeChange: (mode: SessionDialogMode) => void
  showAgentTab?: boolean
  /** Current session agent — drives Agent dock glyph. */
  agentId?: SessionProvider | null
  /** Optional badge on the Agent well (e.g. unread). */
  agentBadge?: string | number | null
  className?: string
}

type DockIcon = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>

type DockItem = {
  mode: SessionDialogMode
  label: string
  icon: DockIcon
  shortcut?: string
  disabled?: boolean
  badge?: string | number | null
  agentId?: SessionProvider | null
}

export function SessionModeDock(props: SessionModeDockProps) {
  const {
    mode,
    onModeChange,
    showAgentTab = false,
    agentId = null,
    agentBadge = null,
    className,
  } = props

  const agentIcon = sessionProviderIcon(agentId) ?? Bot

  const items: DockItem[] = [
    {
      mode: "agent",
      label: "Agent",
      icon: agentIcon,
      disabled: !showAgentTab,
      badge: agentBadge,
      agentId,
    },
    {
      mode: "editor",
      label: "Editor",
      icon: Code2,
      shortcut: "Mod-Shift-e",
    },
    {
      mode: "git",
      label: "Git",
      icon: GitBranch,
      shortcut: "Mod-Shift-g",
    },
    {
      mode: "terminal",
      label: "Terminal",
      icon: SquareTerminal,
      shortcut: "Mod-Shift-t",
    },
  ]

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        data-gharargah-session-mode-dock=""
        data-gharargah-session-mode-switch=""
        aria-label="Session tools"
        className={cn(
          "pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/80 bg-card/70 px-2 py-1.5 shadow-lg backdrop-blur-xl supports-[backdrop-filter]:bg-card/55",
          className,
        )}
      >
        {items.map(item => (
          <DockWell
            key={item.mode}
            item={item}
            active={mode === item.mode}
            onSelect={() => {
              if (item.disabled) return
              onModeChange(item.mode)
            }}
          />
        ))}
      </nav>
    </TooltipProvider>
  )
}

function DockWell(props: {
  item: DockItem
  active: boolean
  onSelect: () => void
}) {
  const { item, active, onSelect } = props
  const { mode, label, icon: Icon, shortcut, disabled = false, badge, agentId } =
    item
  const title = disabled
    ? `${label} (no agent in this session)`
    : shortcut
      ? `${label} (${formatKeyBinding(shortcut)})`
      : label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          id={`gharargah-session-tab-${mode}`}
          aria-label={label}
          aria-controls={`gharargah-session-pane-${mode}`}
          aria-pressed={active}
          title={title}
          disabled={disabled}
          data-gharargah-session-mode-tab={mode}
          data-gharargah-session-mode-agent={
            mode === "agent" && agentId ? agentId : undefined
          }
          data-active={active ? "" : undefined}
          onClick={onSelect}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-[0.7rem] border text-muted-foreground outline-none transition-[color,background-color,border-color,box-shadow] duration-[var(--gharargah-motion-fast)] ease-[var(--gharargah-ease-out)] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40",
            active
              ? "border-border bg-card text-foreground shadow-sm"
              : "border-transparent bg-muted/40 hover:border-border/70 hover:bg-muted/70 hover:text-foreground",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {badge != null && badge !== "" && badge !== 0 ? (
            <span
              data-gharargah-session-mode-badge=""
              className="absolute -end-0.5 -bottom-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[0.55rem] font-semibold leading-none text-primary-foreground"
            >
              {badge}
            </span>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        {title}
      </TooltipContent>
    </Tooltip>
  )
}
