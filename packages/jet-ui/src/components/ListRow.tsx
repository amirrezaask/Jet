import * as React from "react"
import { SidebarMenuButton } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type ListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "default" | "sm" | "lg"
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ className, size = "sm", children, ...props }, ref) => {
    return (
      <SidebarMenuButton
        ref={ref}
        size={size}
        className={cn(
          "shrink-0 w-full flex-col items-stretch justify-center gap-0 overflow-visible p-0 text-left",
          className,
        )}
        {...props}
      >
        {children}
      </SidebarMenuButton>
    )
  },
)
ListRow.displayName = "ListRow"
