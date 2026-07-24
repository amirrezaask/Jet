import type { AgentSessionConfigOption } from "@gharargah/agents"
import { Lock, LockOpen, MoreHorizontal, PenLine } from "lucide-react"
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
import {
  interactionModeLabel,
  type ComposerInteractionMode,
  type ComposerRuntimeMode,
  INTERACTION_MODE_OPTIONS,
} from "./ComposerModeControls.js"
import { buildTraitsTriggerLabel } from "./ComposerTraitsPicker.js"

const RUNTIME_OPTIONS: Array<{
  value: ComposerRuntimeMode
  label: string
  description: string
  icon: typeof Lock
}> = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: Lock,
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLine,
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpen,
  },
]

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  runtimeMode: ComposerRuntimeMode
  interactionMode: ComposerInteractionMode
  availableInteractionModes?: ReadonlyArray<{ id: string; name: string }>
  configOptions: ReadonlyArray<AgentSessionConfigOption>
  disabled?: boolean
  showRuntime?: boolean
  showInteraction?: boolean
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  onConfigOptionChange?: (input: { configId: string; value: string }) => void
}) {
  const {
    runtimeMode,
    interactionMode,
    availableInteractionModes,
    configOptions,
    disabled,
    showRuntime,
    showInteraction,
    onRuntimeModeChange,
    onInteractionModeChange,
    onConfigOptionChange,
  } = props

  const hasTraits = configOptions.length > 0
  const hasMode = Boolean(
    (showRuntime && onRuntimeModeChange) || (showInteraction && onInteractionModeChange),
  )
  if (!hasTraits && !hasMode) return null

  const summaryParts: string[] = []
  if (hasTraits) {
    const traits = buildTraitsTriggerLabel(configOptions)
    if (traits) summaryParts.push(traits)
  }
  if (showInteraction) {
    summaryParts.push(interactionModeLabel(interactionMode, availableInteractionModes))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled}
          data-agent-compact-controls="true"
          data-agent-runtime-mode={showRuntime ? "true" : undefined}
          data-agent-interaction-mode={showInteraction ? "true" : undefined}
          data-agent-config-options={hasTraits ? "true" : undefined}
          aria-label="More agent controls"
          className="shrink-0 active:scale-[0.97] px-1.5 text-muted-foreground/70 hover:text-foreground/80"
        >
          <MoreHorizontal className="size-3.5" />
          {summaryParts.length > 0 ? (
            <span className="max-w-24 truncate text-3xs">{summaryParts.join(" · ")}</span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-56">
        {showRuntime && onRuntimeModeChange ? (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Runtime</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={runtimeMode}
              onValueChange={value => onRuntimeModeChange(value as ComposerRuntimeMode)}
            >
              {RUNTIME_OPTIONS.map(option => {
                const Icon = option.icon
                return (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    className="items-start py-2"
                  >
                    <div className="grid min-w-0 flex-1 gap-0.5">
                      <span className="inline-flex items-center gap-1.5 font-medium">
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
            {showInteraction || hasTraits ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}

        {showInteraction && onInteractionModeChange ? (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Interaction
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={interactionMode}
              onValueChange={value =>
                onInteractionModeChange(value as ComposerInteractionMode)
              }
            >
              {INTERACTION_MODE_OPTIONS.map(mode => (
                <DropdownMenuRadioItem key={mode.value} value={mode.value}>
                  {interactionModeLabel(mode.value, availableInteractionModes)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {hasTraits ? <DropdownMenuSeparator /> : null}
          </>
        ) : null}

        {hasTraits && onConfigOptionChange
          ? configOptions.map((option, index) => (
              <div key={option.id}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  {option.name}
                </DropdownMenuLabel>
                {option.description ? (
                  <p className="px-2 pb-1.5 text-3xs text-muted-foreground/80">
                    {option.description}
                  </p>
                ) : null}
                <DropdownMenuRadioGroup
                  value={option.currentValue ?? ""}
                  onValueChange={value => {
                    if (!value) return
                    onConfigOptionChange({ configId: option.id, value })
                  }}
                >
                  {(option.values ?? []).map(value => (
                    <DropdownMenuRadioItem key={value.value} value={value.value}>
                      {value.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </div>
            ))
          : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
