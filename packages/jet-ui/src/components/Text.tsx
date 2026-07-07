import { cva, type VariantProps } from "class-variance-authority"
import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from "react"
import { cn } from "@/lib/utils.js"

const textVariants = cva("", {
  variants: {
    variant: {
      body: "text-sm text-foreground",
      label: "text-xs font-medium text-foreground",
      caption: "text-xs text-muted-foreground",
      micro: "text-3xs text-muted-foreground",
      nano: "text-4xs text-muted-foreground",
      code: "font-mono text-xs",
    },
    tone: {
      default: "",
      muted: "text-muted-foreground",
      foreground: "text-foreground",
      primary: "text-primary",
      destructive: "text-destructive",
    },
    weight: {
      normal: "font-normal",
      medium: "font-medium",
      semibold: "font-semibold",
    },
    truncate: {
      true: "truncate",
      false: "",
    },
  },
  defaultVariants: {
    variant: "body",
    tone: "default",
    truncate: false,
  },
})

export interface TextProps
  extends ComponentPropsWithoutRef<"span">,
    VariantProps<typeof textVariants> {
  as?: ElementType
}

export const Text = forwardRef<HTMLSpanElement, TextProps>(function Text(
  { as: Component = "span", className, variant, tone, weight, truncate, ...props },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(textVariants({ variant, tone, weight, truncate }), className)}
      {...props}
    />
  )
})

export { textVariants }
