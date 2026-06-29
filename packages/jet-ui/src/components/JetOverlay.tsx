import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"

export function JetOverlay({
  open,
  onOpenChange,
  ariaLabel,
  maxWidth = "32rem",
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  ariaLabel: string
  maxWidth?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, onOpenChange])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "var(--jet-backdrop)",
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth }}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
