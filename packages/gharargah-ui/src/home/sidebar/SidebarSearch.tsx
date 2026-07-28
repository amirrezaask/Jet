import { useEffect, useState, type RefObject } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input.js"
import { Kbd } from "@/components/ui/kbd.js"
import { SidebarInput } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type SidebarSearchProps = {
  value: string
  onChange: (value: string) => void
  /** Debounce ms before propagating (default 150). */
  debounceMs?: number
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}

export function SidebarSearch({
  value,
  onChange,
  debounceMs = 150,
  inputRef,
  className,
}: SidebarSearchProps) {
  const [local, setLocal] = useState(value)

  useEffect(() => {
    setLocal(value)
  }, [value])

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (local !== value) onChange(local)
    }, debounceMs)
    return () => window.clearTimeout(t)
  }, [local, value, onChange, debounceMs])

  return (
    <div
      className={cn("relative min-w-0", className)}
      data-gharargah-sidebar-search=""
    >
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <SidebarInput
        ref={inputRef}
        value={local}
        onChange={e => setLocal(e.target.value)}
        placeholder="Search"
        aria-label="Search sessions"
        className="h-8 rounded-lg pl-8 pr-10 text-xs"
        data-gharargah-sidebar-search-input=""
      />
      <Kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[0.625rem]">
        ⌘K
      </Kbd>
    </div>
  )
}

/** Re-export Input for tests that need a plain field. */
export { Input as SidebarSearchInput }
