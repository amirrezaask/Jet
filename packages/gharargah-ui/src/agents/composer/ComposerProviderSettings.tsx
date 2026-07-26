import type { AgentSessionConfigOption } from "@gharargah/agents"
import { Lock, LockOpen, PenLine } from "lucide-react"
import { memo, useMemo } from "react"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import {
  INTERACTION_MODE_OPTIONS,
  type ComposerInteractionMode,
  type ComposerRuntimeMode,
} from "./ComposerModeControls.js"

const ACCESS_OPTIONS: ReadonlyArray<{
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
    label: "Edit freely",
    description: "Apply file edits automatically; ask before commands.",
    icon: PenLine,
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Run commands and edit files without prompts.",
    icon: LockOpen,
  },
]

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

function availableInteractionOptions(
  modes: ReadonlyArray<{ id: string; name: string }> | undefined,
) {
  if (!modes?.length) return INTERACTION_MODE_OPTIONS
  const advertised = new Set(modes.flatMap(mode => [normalized(mode.id), normalized(mode.name)]))
  const supported = INTERACTION_MODE_OPTIONS.filter(option =>
    option.aliases.some(alias => advertised.has(normalized(alias))),
  )
  return supported.length > 0 ? supported : INTERACTION_MODE_OPTIONS
}

function currentOptionDescription(option: AgentSessionConfigOption): string | null {
  if (option.description) return option.description
  const current = option.values?.find(value => value.value === option.currentValue)
  return current?.name ? `${option.name}: ${current.name}` : null
}

export const ComposerProviderSettings = memo(function ComposerProviderSettings(props: {
  providerName: string
  runtimeMode: ComposerRuntimeMode
  interactionMode: ComposerInteractionMode
  availableInteractionModes?: ReadonlyArray<{ id: string; name: string }>
  configOptions: ReadonlyArray<AgentSessionConfigOption>
  showRuntime: boolean
  showInteraction: boolean
  disabled?: boolean
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  onConfigOptionChange?: (input: { configId: string; value: string }) => void
}) {
  const interactionOptions = useMemo(
    () => availableInteractionOptions(props.availableInteractionModes),
    [props.availableInteractionModes],
  )
  const hasSettings =
    (props.showRuntime && props.onRuntimeModeChange) ||
    (props.showInteraction && props.onInteractionModeChange) ||
    (props.configOptions.length > 0 && props.onConfigOptionChange)

  if (!hasSettings) return null

  const selectedAccess =
    ACCESS_OPTIONS.find(option => option.value === props.runtimeMode) ?? ACCESS_OPTIONS[0]!
  const selectedInteraction =
    interactionOptions.find(option => option.value === props.interactionMode) ??
    interactionOptions[0]

  return (
    <aside
      className="flex h-screen max-h-96 w-72 shrink-0 flex-col overflow-y-auto border-l bg-popover p-3"
      data-agent-provider-settings={props.providerName.toLowerCase()}
      aria-label={`${props.providerName} settings`}
    >
      <div className="mb-3">
        <p className="text-xs font-medium text-foreground">{props.providerName} settings</p>
        <p className="mt-0.5 text-3xs leading-4 text-muted-foreground">
          Only controls supported by this provider are shown.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {props.showInteraction && props.onInteractionModeChange ? (
          <section className="flex flex-col gap-1.5" data-agent-setting-group="mode">
            <div>
              <p className="text-xs font-medium text-foreground">Mode</p>
              <p className="text-3xs leading-4 text-muted-foreground">
                {selectedInteraction?.description ?? "How the agent handles this task."}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={props.interactionMode}
              variant="outline"
              size="sm"
              disabled={props.disabled}
              className="w-full gap-0"
              onValueChange={value => {
                if (value) props.onInteractionModeChange?.(value as ComposerInteractionMode)
              }}
            >
              {interactionOptions.map(option => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="min-w-0 flex-1 px-2 text-xs"
                  aria-label={`${option.label}: ${option.description}`}
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>
        ) : null}

        {props.configOptions.map(option => (
          <section
            key={option.id}
            className="flex flex-col gap-1.5"
            data-agent-setting-group={option.id}
          >
            <div>
              <p className="text-xs font-medium text-foreground">{option.name}</p>
              {currentOptionDescription(option) ? (
                <p className="text-3xs leading-4 text-muted-foreground">
                  {currentOptionDescription(option)}
                </p>
              ) : null}
            </div>
            <ToggleGroup
              type="single"
              value={option.currentValue ?? ""}
              variant="outline"
              size="sm"
              disabled={props.disabled || !props.onConfigOptionChange}
              className="w-full gap-0"
              onValueChange={value => {
                if (value) props.onConfigOptionChange?.({ configId: option.id, value })
              }}
            >
              {(option.values ?? []).map(value => (
                <ToggleGroupItem
                  key={value.value}
                  value={value.value}
                  className="min-w-0 flex-1 px-2 text-xs"
                >
                  {value.name}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </section>
        ))}

        {props.showRuntime && props.onRuntimeModeChange ? (
          <section className="flex flex-col gap-1.5" data-agent-setting-group="access">
            <div>
              <p className="text-xs font-medium text-foreground">Access</p>
              <p className="text-3xs leading-4 text-muted-foreground">
                {selectedAccess.description}
              </p>
            </div>
            <ToggleGroup
              type="single"
              value={props.runtimeMode}
              variant="outline"
              size="sm"
              disabled={props.disabled}
              className="w-full gap-0"
              onValueChange={value => {
                if (value) props.onRuntimeModeChange?.(value as ComposerRuntimeMode)
              }}
            >
              {ACCESS_OPTIONS.map(option => {
                const Icon = option.icon
                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    className="min-w-0 flex-1 px-1 text-3xs"
                    aria-label={`${option.label}: ${option.description}`}
                  >
                    <Icon data-icon="inline-start" />
                    <span className="truncate">{option.label}</span>
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </section>
        ) : null}
      </div>
    </aside>
  )
})
