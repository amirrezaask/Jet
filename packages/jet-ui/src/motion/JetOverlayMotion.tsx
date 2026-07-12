import { cn } from "@/lib/utils.js"
import { useReducedMotion } from "./useReducedMotion.js"

export function JetTabDragGhost({
  label,
  dirty,
  className,
}: {
  label: string
  dirty?: boolean
  className?: string
}) {
  const reduced = useReducedMotion()

  return (
    <div
      data-jet-tab-drag-ghost
      className={cn(
        "flex h-8 items-center gap-1 rounded-sm border border-primary/40 bg-muted/95 px-2 text-xs shadow-lg",
        !reduced && "rotate-1 scale-[1.04]",
        className,
      )}
    >
      <span className="truncate font-medium">
        {label}
        {dirty ? " •" : ""}
      </span>
    </div>
  )
}
