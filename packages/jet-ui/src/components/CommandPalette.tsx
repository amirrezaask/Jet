import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge.js"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import { KeyBindingKbd } from "./KeyBindingKbd.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

export function CommandPalette({
  open,
  onOpenChange,
  commands,
  onRun,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  commands: {
    id: string
    title: string
    category?: string
    keybinding?: string
    aliases?: string[]
    recent?: boolean
  }[]
  onRun: (id: string) => void
}) {
  const [query, setQuery] = useState("")
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [open])

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
    }
  }, [query])

  const items = useMemo(
    () =>
      commands.map(cmd => ({
        id: cmd.id,
        value: `${cmd.id} ${cmd.title} ${(cmd.aliases ?? []).join(" ")}`,
        cmd,
      })),
    [commands],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Command palette</DialogTitle>
        <DialogDescription>Search commands…</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[34rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          value={selectedValue}
          onValueChange={value => {
            if (query.trim() === "") {
              setSelectedValue(COMMAND_NO_SELECTION)
              return
            }
            setSelectedValue(value)
          }}
        >
          <CommandInput
            placeholder="Search commands…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[22rem]">
            <CommandEmpty>No results.</CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {items.map(({ id, value, cmd }) => (
              <CommandItem
                key={id}
                value={value}
                onSelect={() => {
                  onRun(id)
                  onOpenChange(false)
                }}
              >
                <span className="flex w-full items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium">{cmd.title}</span>
                      {cmd.recent && (
                        <Badge variant="secondary" className="text-xs">
                          Recent
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {cmd.category && <span>{cmd.category}</span>}
                      {cmd.category && cmd.aliases?.length ? <span aria-hidden>·</span> : null}
                      {cmd.aliases?.length ? <span>{cmd.aliases.join(" · ")}</span> : null}
                    </span>
                  </span>
                  {cmd.keybinding ? (
                    <KeyBindingKbd binding={cmd.keybinding} className="ml-auto shrink-0" />
                  ) : null}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
