import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"

export function GotoLineModal({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (line: number, column: number) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open || typeof document === "undefined") return null

  const handleSubmit = () => {
    const raw = inputRef.current?.value.trim() ?? ""
    if (!raw) return
    const match = /^(\d+)(?::(\d+))?$/.exec(raw)
    if (!match) return
    const line = Number.parseInt(match[1]!, 10)
    const column = match[2] ? Number.parseInt(match[2], 10) : 1
    if (line < 1) return
    onSubmit(line, column)
    onOpenChange(false)
    if (inputRef.current) inputRef.current.value = ""
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Go to line"
      onClick={() => onOpenChange(false)}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "rgba(0,0,0,0.5)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-md border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] shadow-2xl"
      >
        <div className="border-b border-[var(--jet-border)] px-3 py-2 text-sm font-medium">
          Go to Line
        </div>
        <div className="p-3">
          <input
            ref={inputRef}
            type="text"
            placeholder="Line or line:column"
            className="w-full rounded border border-[var(--jet-border)] bg-transparent px-2 py-1.5 text-sm outline-none focus:border-[var(--jet-accent)]"
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleSubmit()
              }
              if (e.key === "Escape") onOpenChange(false)
            }}
          />
          <p className="mt-2 text-xs text-[var(--jet-text-muted)]">Example: 42 or 42:10</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
