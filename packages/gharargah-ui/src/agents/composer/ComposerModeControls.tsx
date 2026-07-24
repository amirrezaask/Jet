import { Bot, ChevronDown, Lock, LockOpen, PenLine, PencilRuler } from "lucide-react"
import { memo } from "react"
import { Button } from "@/components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js"
import { Separator } from "@/components/ui/separator.js"
import { cn } from "@/lib/utils.js"

export type ComposerRuntimeMode = "approval-required" | "auto-accept-edits" | "full-access"
export type ComposerInteractionMode = "implement" | "plan" | "ask"

const RUNTIME_MODE_CONFIG: Record<
  ComposerRuntimeMode,
  { label: string; description: string; icon: typeof Lock }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: Lock,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLine,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpen,
  },
}

const RUNTIME_MODE_OPTIONS = Object.keys(RUNTIME_MODE_CONFIG) as ComposerRuntimeMode[]

export const INTERACTION_MODE_OPTIONS = [
  { value: "implement" as const, label: "Build", aliases: ["agent", "code", "default", "chat", "implement"] },
  { value: "plan" as const, label: "Plan", aliases: ["plan", "architect"] },
  { value: "ask" as const, label: "Ask", aliases: ["ask"] },
]

export function interactionModeLabel(
  mode: ComposerInteractionMode,
  availableModes?: ReadonlyArray<{ id: string; name: string }>,
): string {
  const option = INTERACTION_MODE_OPTIONS.find(candidate => candidate.value === mode)
  if (!availableModes?.length) return option?.label ?? mode
  const aliases = option?.aliases ?? []
  const match = availableModes.find(candidate =>
    aliases.some(
      alias =>
        candidate.id.toLowerCase() === alias || candidate.name.toLowerCase() === alias,
    ),
  )
  return match?.name ?? option?.label ?? mode
}

export const ComposerModeControls = memo(function ComposerModeControls(props: {
  runtimeMode: ComposerRuntimeMode
  interactionMode: ComposerInteractionMode
  availableInteractionModes?: ReadonlyArray<{ id: string; name: string }>
  disabled?: boolean
  showRuntime?: boolean
  showInteraction?: boolean
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  compact?: boolean
}) {
  const {
    runtimeMode,
    interactionMode,
    availableInteractionModes,
    disabled,
    showRuntime = true,
    showInteraction = true,
    onRuntimeModeChange,
    onInteractionModeChange,
    compact,
  } = props

  const runtime = RUNTIME_MODE_CONFIG[runtimeMode] ?? RUNTIME_MODE_CONFIG["approval-required"]
  const RuntimeIcon = runtime.icon
  const isPlan = interactionMode === "plan"
  const interactionLabel = interactionModeLabel(interactionMode, availableInteractionModes)
  const interactionTooltip =
    interactionMode === "plan"
      ? "Plan mode — click to return to build mode"
      : interactionMode === "ask"
        ? "Ask mode — click to return to build mode"
        : "Build mode — click to enter plan mode"

  const toggleInteraction = () => {
    if (!onInteractionModeChange) return
    if (interactionMode === "plan" || interactionMode === "ask") {
      onInteractionModeChange("implement")
      return
    }
    onInteractionModeChange("plan")
  }

  return (
    <>
      {showRuntime && onRuntimeModeChange ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                disabled={disabled}
                data-agent-runtime-mode="true"
                aria-label={`Runtime mode: ${runtime.label}. ${runtime.description}`}
                title={runtime.description}
                className={cn(
                  "shrink-0 gap-1 active:scale-[0.97] font-medium text-muted-foreground/70 hover:text-foreground/80",
                  compact ? "px-1.5" : "px-2",
                )}
              >
                <RuntimeIcon className="size-3.5" />
                {!compact ? <span className="truncate">{runtime.label}</span> : null}
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="min-w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Runtime</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={runtimeMode}
                onValueChange={value => onRuntimeModeChange(value as ComposerRuntimeMode)}
              >
                {RUNTIME_MODE_OPTIONS.map(mode => {
                  const option = RUNTIME_MODE_CONFIG[mode]
                  const Icon = option.icon
                  return (
                    <DropdownMenuRadioItem key={mode} value={mode} className="items-start py-2">
                      <div className="grid min-w-0 flex-1 gap-0.5">
                        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                          {option.label}
                        </span>
                        <span className="text-muted-foreground text-3xs leading-4">
                          {option.description}
                        </span>
                      </div>
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      {showInteraction && onInteractionModeChange ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={disabled}
            data-agent-interaction-mode="true"
            aria-label={interactionTooltip}
            title={interactionTooltip}
            onClick={toggleInteraction}
            className={cn(
              "shrink-0 gap-1 active:scale-[0.97]",
              compact ? "px-1.5" : "px-2",
              isPlan
                ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/15 hover:text-blue-300"
                : "text-muted-foreground/70 hover:text-foreground/80",
            )}
          >
            {isPlan ? (
              <PencilRuler className="size-3.5 text-current opacity-100" />
            ) : (
              <Bot className="size-3.5" />
            )}
            {!compact ? <span>{interactionLabel}</span> : null}
          </Button>
        </>
      ) : null}
    </>
  )
})
