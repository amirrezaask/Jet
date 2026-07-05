import * as React from "react"
import { SidebarMenuButton } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type ListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "default" | "sm" | "lg"
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ className, size = "default", children, ...props }, ref) => {
    return (
      <SidebarMenuButton
        asChild
        size={size}
        className={cn("shrink-0 flex-col justify-center gap-0 px-2 text-left", className)}
      >
        <button ref={ref} type="button" data-slot="list-row" {...props}>
          {children}
        </button>
      </SidebarMenuButton>
    )
  },
)
ListRow.displayName = "ListRow"
