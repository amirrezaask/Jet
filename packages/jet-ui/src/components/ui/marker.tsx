import * as React from "react"
import { cn } from "@/lib/utils.js"

type MarkerVariant = "status" | "separator" | "tool" | "approval" | "error"

function Marker({
  className,
  variant = "status",
  ...props
}: React.ComponentProps<"div"> & { variant?: MarkerVariant }) {
  return (
    <div
      data-slot="marker"
      className={cn(
        "flex w-full items-center gap-2 text-xs",
        variant === "separator" && "py-2",
        variant === "error" && "text-destructive",
        variant === "approval" && "text-amber-600 dark:text-amber-400",
        className,
      )}
      {...props}
    />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker-content"
      className={cn(
        "min-w-0 flex-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="marker-icon"
      className={cn("flex size-5 shrink-0 items-center justify-center text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Marker, MarkerContent, MarkerIcon, type MarkerVariant }
