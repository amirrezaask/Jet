import * as React from "react"
import { cn } from "@/lib/utils.js"

type MessageAlign = "start" | "end"

function Message({
  className,
  align = "start",
  ...props
}: React.ComponentProps<"div"> & { align?: MessageAlign }) {
  return (
    <div
      data-slot="message"
      className={cn(
        "flex w-full gap-2",
        align === "end" ? "flex-row-reverse" : "flex-row",
        className,
      )}
      {...props}
    />
  )
}

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn("flex min-w-0 max-w-[min(100%,42rem)] flex-col gap-1", className)}
      {...props}
    />
  )
}

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn("text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function MessageFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-footer"
      className={cn("text-[10px] text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Message, MessageAvatar, MessageContent, MessageHeader, MessageFooter }
