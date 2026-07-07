import { cva, type VariantProps } from "class-variance-authority"
import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from "react"
import { cn } from "@/lib/utils.js"

const surfaceVariants = cva("", {
  variants: {
    elevation: {
      flat: "bg-background text-foreground",
      raised: "bg-card text-card-foreground border rounded-md",
      overlay: "bg-popover text-popover-foreground border rounded-md shadow-md",
      inset: "bg-muted text-foreground rounded-md",
    },
    padding: {
      none: "",
      sm: "p-2",
      md: "p-3",
      lg: "p-4",
    },
  },
  defaultVariants: {
    elevation: "flat",
    padding: "none",
  },
})

export interface SurfaceProps
  extends ComponentPropsWithoutRef<"div">,
    VariantProps<typeof surfaceVariants> {
  as?: ElementType
}

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { as: Component = "div", className, elevation, padding, ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(surfaceVariants({ elevation, padding }), className)}
      {...props}
    />
  )
})

export { surfaceVariants }
