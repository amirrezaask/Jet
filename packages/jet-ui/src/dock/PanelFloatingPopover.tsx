import { useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react"
import { createPortal } from "react-dom"
import type { PanelId } from "@jet/shared"
import { cn } from "@/lib/utils.js"

export type PanelFloatCorner = "top-right" | "top-left" | "bottom-right" | "bottom-left"

export type PanelFloatingPopoverProps = {
  panelId: PanelId
  open: boolean
  onOpenChange?: (open: boolean) => void
  corner: PanelFloatCorner
  inset?: Partial<{ top: number; right: number; bottom: number; left: number }>
  contentClassName?: string
  children: ReactNode
}

const DEFAULT_INSET: Record<PanelFloatCorner, { top: number; right: number; bottom: number; left: number }> = {
  "top-right": { top: 4, right: 8, bottom: 4, left: 8 },
  "top-left": { top: 4, right: 8, bottom: 4, left: 8 },
  "bottom-right": { top: 4, right: 8, bottom: 4, left: 8 },
  "bottom-left": { top: 4, right: 8, bottom: 4, left: 8 },
}

function cornerStyle(
  corner: PanelFloatCorner,
  rect: DOMRect,
  inset: { top: number; right: number; bottom: number; left: number },
): CSSProperties {
  switch (corner) {
    case "top-right":
      return { top: rect.top + inset.top, left: rect.right - inset.right, transform: "translateX(-100%)" }
    case "top-left":
      return { top: rect.top + inset.top, left: rect.left + inset.left }
    case "bottom-right":
      return {
        top: rect.bottom - inset.bottom,
        left: rect.right - inset.right,
        transform: "translate(-100%, -100%)",
      }
    case "bottom-left":
      return { top: rect.bottom - inset.bottom, left: rect.left + inset.left, transform: "translateY(-100%)" }
  }
}

export function PanelFloatingPopover({
  panelId,
  open,
  onOpenChange,
  corner,
  inset,
  contentClassName,
  children,
}: PanelFloatingPopoverProps) {
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const mergedInset = { ...DEFAULT_INSET[corner], ...inset }

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null)
      return
    }
    const measure = () => {
      const leaf = document.querySelector(`[data-jet-panel-leaf="${panelId.id}"]`)
      if (!leaf) return
      setStyle(cornerStyle(corner, leaf.getBoundingClientRect(), mergedInset))
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [open, panelId.id, corner, mergedInset.top, mergedInset.right, mergedInset.bottom, mergedInset.left])

  if (!open || !style) return null

  return createPortal(
    <div
      data-jet-panel-float=""
      className={cn(
        "fixed z-50 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-hidden",
        contentClassName,
      )}
      style={style}
    >
      {children}
    </div>,
    document.body,
  )
}
