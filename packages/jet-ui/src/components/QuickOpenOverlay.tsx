import { useDeferredValue, useEffect, useRef, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command.js"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Spinner } from "@/components/ui/spinner.js"
import { COMMAND_NO_SELECTION, COMMAND_SHELL_CLASS } from "@/lib/command-shell.js"

export function QuickOpenOverlay({
  open,
  onOpenChange,
  onSearch,
  scanReady = true,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<string[]>
  scanReady?: boolean
  onSelect: (path: string, query: string) => void
}) {
  const [query, setQuery] = useState("")
  const [selectedValue, setSelectedValue] = useState(COMMAND_NO_SELECTION)
  const [results, setResults] = useState<string[]>([])
  const [searching, setSearching] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const searchGen = useRef(0)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setSelectedValue(COMMAND_NO_SELECTION)
      setResults([])
      setSearching(false)
    }
  }, [open])

  useEffect(() => {
    if (!open || !scanReady) {
      setResults([])
      return
    }

    const gen = ++searchGen.current
    const id = window.setTimeout(() => {
      setSearching(true)
      void onSearch(deferredQuery)
        .then(paths => {
          if (gen !== searchGen.current) return
          setResults(paths)
          setSearching(false)
        })
        .catch(() => {
          if (gen !== searchGen.current) return
          setResults([])
          setSearching(false)
        })
    }, 80)

    return () => window.clearTimeout(id)
  }, [open, scanReady, deferredQuery, onSearch])

  useEffect(() => {
    if (query.trim() === "") {
      setSelectedValue(COMMAND_NO_SELECTION)
      return
    }
    if (results.length > 0 && !results.includes(selectedValue)) {
      setSelectedValue(results[0]!)
    }
  }, [results, query, selectedValue])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Quick open</DialogTitle>
        <DialogDescription>Type a file name…</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-[36rem] overflow-hidden p-0" showCloseButton={false}>
        <Command
          className={COMMAND_SHELL_CLASS}
          shouldFilter={false}
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
            placeholder={scanReady ? "Type a file name…" : "Indexing workspace…"}
            value={query}
            onValueChange={setQuery}
            disabled={!scanReady}
          />
          {!scanReady && (
            <div className="flex items-center gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
              <Spinner />
              Indexing workspace…
            </div>
          )}
          {scanReady && searching && (
            <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
              <Spinner />
              Searching…
            </div>
          )}
          <CommandList className="max-h-[var(--jet-overlay-list-max)]">
            <CommandEmpty>
              {scanReady ? "No matching files." : "Waiting for index…"}
            </CommandEmpty>
            <CommandItem value={COMMAND_NO_SELECTION} className="hidden" aria-hidden />
            {results.map(path => (
              <CommandItem
                key={path}
                value={path}
                onSelect={() => {
                  onSelect(path, query)
                  onOpenChange(false)
                }}
              >
                <span className="font-mono">{path}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
