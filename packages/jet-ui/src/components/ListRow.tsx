import * as React from "react"
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type ListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "default" | "sm" | "lg"
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ className, size = "sm", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size={size}
        className={cn(
          sidebarMenuButtonVariants({ size }),
          "h-full min-h-0 shrink-0 w-full flex-col items-stretch justify-center gap-0 overflow-hidden p-0 text-left",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    )
  },
)
ListRow.displayName = "ListRow"
