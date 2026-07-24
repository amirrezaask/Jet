import type { AgentSessionConfigOption } from "@gharargah/agents"
import { ChevronDown } from "lucide-react"
import { memo, useMemo } from "react"
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
import { cn } from "@/lib/utils.js"

function optionCurrentLabel(option: AgentSessionConfigOption): string | null {
  const current = option.currentValue
  if (!current) return null
  const match = option.values?.find(value => value.value === current)
  if (match?.name) return match.name
  if (option.id.toLowerCase().includes("fast")) {
    return current === "true" || current.toLowerCase() === "fast" ? "Fast" : "Normal"
  }
  return current
}

export function buildTraitsTriggerLabel(
  options: ReadonlyArray<AgentSessionConfigOption>,
): string {
  const labels: string[] = []
  for (const option of options) {
    const label = optionCurrentLabel(option)
    if (label) labels.push(label)
  }
  return labels.join(" · ")
}

export const ComposerTraitsPicker = memo(function ComposerTraitsPicker(props: {
  options: ReadonlyArray<AgentSessionConfigOption>
  disabled?: boolean
  compact?: boolean
  onConfigOptionChange?: (input: { configId: string; value: string }) => void
  className?: string
}) {
  const { options, disabled, compact, onConfigOptionChange, className } = props
  const triggerLabel = useMemo(() => buildTraitsTriggerLabel(options), [options])

  if (options.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled || !onConfigOptionChange}
          data-agent-config-options="true"
          aria-label="Agent options"
          className={cn(
            "shrink-0 active:scale-[0.97] text-muted-foreground/70 hover:text-foreground/80",
            compact ? "max-w-28 overflow-hidden px-1.5" : "max-w-48 px-2",
            className,
          )}
        >
          <span className="truncate">{triggerLabel || "Options"}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="min-w-56">
        {options.map((option, index) => (
          <div key={option.id}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {option.name}
            </DropdownMenuLabel>
            {option.description ? (
              <p className="px-2 pb-1.5 text-3xs text-muted-foreground/80">{option.description}</p>
            ) : null}
            <DropdownMenuRadioGroup
              value={option.currentValue ?? ""}
              onValueChange={value => {
                if (!value) return
                onConfigOptionChange?.({ configId: option.id, value })
              }}
            >
              {(option.values ?? []).map(value => (
                <DropdownMenuRadioItem key={value.value} value={value.value} className="text-xs">
                  {value.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
