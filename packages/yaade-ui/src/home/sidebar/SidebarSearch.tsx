import { useEffect, useState, useTransition, type RefObject } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input.js"
import { SidebarInput } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type SidebarSearchProps = {
  value: string
  onChange: (value: string) => void
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

export function SidebarSearch({
  value,
  onChange,
  inputRef,
  className,
}: SidebarSearchProps) {
  const [local, setLocal] = useState(value)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setLocal(value)
  }, [value])

  return (
    <div
      className={cn("relative min-w-0", className)}
      data-yaade-sidebar-search=""
      data-pending={isPending ? "" : undefined}
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <SidebarInput
        ref={inputRef}
        value={local}
        onChange={(event) => {
          const next = event.target.value
          setLocal(next)
          startTransition(() => onChange(next))
        }}
        placeholder="Search"
        aria-label="Search sessions"
        aria-busy={isPending}
        className="h-8 rounded-lg pl-8 pr-3 text-xs"
        data-yaade-sidebar-search-input=""
      />
    </div>
  )
}

/** Re-export Input for tests that need a plain field. */
export { Input as SidebarSearchInput }
