import * as React from "react"
import { SidebarMenuSubButton } from "@/components/ui/sidebar.js"
import { jetFocusRingClass, jetInteractiveRowClass } from "@/motion/tokens.js"
import { cn } from "@/lib/utils.js"

export type ListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "md"
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ className, size = "sm", children, ...props }, ref) => {
    return (
      <SidebarMenuSubButton
        asChild
        size={size}
        className={cn(
          "group h-auto min-h-[var(--jet-location-row-height)] w-full shrink-0 flex-col items-stretch justify-center gap-0 overflow-hidden p-0 text-left text-foreground",
          jetInteractiveRowClass,
          jetFocusRingClass,
          className,
        )}
      >
        <button ref={ref} type="button" {...props}>
          {children}
        </button>
      </SidebarMenuSubButton>
    )
  },
)
ListRow.displayName = "ListRow"
