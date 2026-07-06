import * as React from "react"
import { cn } from "@/lib/utils.js"

type MessageBubbleAlign = "start" | "end"

function Bubble({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: MessageBubbleAlign }) {
  return (
    <div
      data-slot="bubble"
      className={cn(
        "rounded-lg border px-3 py-2 text-sm leading-relaxed",
        align === "end"
          ? "border-primary/20 bg-primary/10 text-foreground"
          : "border-border bg-card text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function BubbleContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="bubble-content" className={cn("whitespace-pre-wrap break-words", className)} {...props} />
}

export { Bubble, BubbleContent }
