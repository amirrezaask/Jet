import { useEffect, useMemo, useState } from "react"
import { fuzzyMatchFiles } from "@jet/workspace"
import { JetFuzzyPicker } from "./JetFuzzyPicker.js"

export function QuickOpenOverlay({
  open,
  onOpenChange,
  files,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  files: string[]
  onSelect: (path: string) => void
}) {
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const filtered = useMemo(() => fuzzyMatchFiles(query, files, 100), [query, files])

  const items = useMemo(
    () =>
      filtered.map(path => ({
        value: path,
        label: <span className="font-mono">{path}</span>,
        onSelect: () => onSelect(path),
      })),
    [filtered, onSelect],
  )

  return (
    <JetFuzzyPicker
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Quick open"
      placeholder="Type a file name…"
      emptyMessage="No matching files."
      maxWidth="36rem"
      maxListHeight="20rem"
      shouldFilter={false}
      query={query}
      onQueryChange={setQuery}
      items={items}
    />
  )
}
