import { useMemo } from "react"
import { Bot, SquareTerminal } from "lucide-react"
import { PaletteShell, type PaletteShellItem } from "../components/palette/PaletteShell.js"
import {
  AGENT_CLI_DRIVERS,
  type AgentCliDriver,
} from "./agent-cli-drivers.js"

export type AgentCliPickerOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (driver: AgentCliDriver) => void
}

export function AgentCliPickerOverlay(props: AgentCliPickerOverlayProps) {
  const { open, onOpenChange, onSelect } = props

  const items = useMemo<PaletteShellItem<AgentCliDriver>[]>(
    () =>
      AGENT_CLI_DRIVERS.map(driver => ({
        key: driver.id,
        value: `${driver.label} ${driver.description} ${driver.command ?? "shell"}`,
        data: driver,
      })),
    [],
  )

  return (
    <PaletteShell
      open={open}
      onOpenChange={onOpenChange}
      title="Choose agent"
      description="Pick an agent CLI for this session"
      placeholder="Filter agents…"
      size="picker"
      items={items}
      onSelect={onSelect}
      emptyLabel="No matching agents."
      renderItem={driver => (
        <>
          {driver.id === "shell" ? (
            <SquareTerminal className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <Bot className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span
              data-gharargah-agent-cli-option={driver.id}
              className="truncate text-sm font-medium text-foreground"
            >
              {driver.label}
            </span>
            <span className="truncate font-mono text-3xs text-muted-foreground">
              {driver.command ?? "login shell"}
              {" · "}
              {driver.description}
            </span>
          </span>
        </>
      )}
    />
  )
}
