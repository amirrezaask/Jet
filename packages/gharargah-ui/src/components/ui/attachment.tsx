import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

const attachmentVariants = cva(
  "group/attachment relative flex w-fit max-w-full min-w-0 shrink-0 items-center rounded-lg border bg-card text-card-foreground transition-colors",
  {
    variants: {
      size: {
        default: "gap-2 px-2.5 py-2 text-sm",
        sm: "gap-1.5 px-2 py-1.5 text-xs",
        xs: "gap-1.5 px-1.5 py-1 text-xs",
      },
    },
    defaultVariants: {
      size: "default",
    },
  },
)

function Attachment({
  className,
  size,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof attachmentVariants>) {
  return (
    <div
      data-slot="attachment"
      className={cn(attachmentVariants({ size }), className)}
      {...props}
    />
  )
}

function AttachmentMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-media"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-foreground [&_img]:size-full [&_img]:object-cover [&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  )
}

function AttachmentContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn("min-w-0 flex-1 leading-tight", className)}
      {...props}
    />
  )
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-title"
      className={cn("block max-w-44 truncate font-medium", className)}
      {...props}
    />
  )
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="attachment-description"
      className={cn("mt-0.5 block max-w-44 truncate text-3xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function AttachmentAction({
  className,
  size = "icon-xs",
  variant = "ghost",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      size={size}
      variant={variant}
      className={cn("shrink-0", className)}
      {...props}
    />
  )
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        "flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    />
  )
}

export {
  Attachment,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
}
