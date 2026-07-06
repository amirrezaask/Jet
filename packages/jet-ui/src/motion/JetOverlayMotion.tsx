"use client"

import { motion, type HTMLMotionProps } from "motion/react"
import { jetMotion } from "./tokens.js"
import { useReducedMotion } from "./useReducedMotion.js"
import { cn } from "@/lib/utils.js"

export function JetMotionDiv({
  className,
  reducedMotion: reducedMotionProp,
  variant = "center",
  ...props
}: HTMLMotionProps<"div"> & {
  reducedMotion?: boolean
  variant?: "center" | "top"
}) {
  const reducedHook = useReducedMotion()
  const reduced = reducedMotionProp ?? reducedHook
  const preset = variant === "top" ? jetMotion.overlayEnterTop : jetMotion.overlayEnter

  if (reduced) {
    return <div className={className} {...(props as React.ComponentProps<"div">)} />
  }

  return (
    <motion.div
      className={className}
      initial={preset.initial}
      animate={preset.animate}
      exit={preset.exit}
      transition={preset.transition}
      {...props}
    />
  )
}

export function JetTabDragGhost({
  label,
  dirty,
  className,
}: {
  label: string
  dirty?: boolean
  className?: string
}) {
  const reduced = useReducedMotion()

  return (
    <JetMotionDiv
      variant="center"
      reducedMotion={reduced}
      className={cn(
        "flex h-8 items-center gap-1 rounded-sm border border-primary/40 bg-muted/95 px-2 text-xs shadow-lg",
        !reduced && "rotate-1 scale-[1.04]",
        className,
      )}
      {...(!reduced
        ? {
            layout: false,
            transition: jetMotion.tabGhostSpring,
          }
        : {})}
    >
      <span className="truncate font-medium">
        {label}
        {dirty ? " •" : ""}
      </span>
    </JetMotionDiv>
  )
}
