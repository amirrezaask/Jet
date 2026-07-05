import * as React from "react"
import { Slot } from "radix-ui"
import { sidebarMenuButtonVariants } from "@/components/ui/sidebar.js"
import { cn } from "@/lib/utils.js"

export type ListRowProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean
  size?: "default" | "sm" | "lg"
}

export const ListRow = React.forwardRef<HTMLButtonElement, ListRowProps>(
  ({ className, size = "default", asChild = false, children, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button"
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : "button"}
        data-slot="list-row"
        className={cn(
          sidebarMenuButtonVariants({ variant: "default", size }),
          "flex-col justify-center gap-0 px-2 text-left",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    )
  },
)
ListRow.displayName = "ListRow"
