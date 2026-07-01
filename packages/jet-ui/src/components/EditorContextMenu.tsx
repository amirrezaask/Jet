import { useEffect, useRef, useState } from "react"
import type { EditorView } from "@codemirror/view"
import { scheduleCodeActions, applyCodeAction, type LspCodeAction } from "@jet/lsp"

type MenuItem =
  | { type: "action"; label: string; shortcut?: string; run: () => void; disabled?: boolean }
  | { type: "separator" }

let openAtHandler: ((x: number, y: number) => void) | null = null

export function registerEditorContextMenuHandler(fn: (x: number, y: number) => void): () => void {
  openAtHandler = fn
  return () => {
    if (openAtHandler === fn) openAtHandler = null
  }
}

export function showEditorContextMenuAt(x: number, y: number): void {
  openAtHandler?.(x, y)
}

export function EditorContextMenu({
  open,
  position,
  view,
  lspAvailable,
  hasLspPlugin,
  onClose,
  executeCommand,
}: {
  open: boolean
  position: { x: number; y: number } | null
  view: EditorView | null
  lspAvailable: boolean
  hasLspPlugin: boolean
  onClose: () => void
  executeCommand: (name: string) => Promise<void>
}) {
  const [codeActions, setCodeActions] = useState<LspCodeAction[]>([])
  const [loadingActions, setLoadingActions] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !view || !lspAvailable) {
      setCodeActions([])
      return
    }
    setLoadingActions(true)
    void scheduleCodeActions(view, true).then(actions => {
      setCodeActions(actions)
      setLoadingActions(false)
    })
  }, [open, view, lspAvailable])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    const onPointer = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener("keydown", onKey, true)
    window.addEventListener("mousedown", onPointer, true)
    return () => {
      window.removeEventListener("keydown", onKey, true)
      window.removeEventListener("mousedown", onPointer, true)
    }
  }, [open, onClose])

  if (!open || !position) return null

  const hasLsp = lspAvailable && hasLspPlugin && view

  const items: MenuItem[] = [
    {
      type: "action",
      label: "Cut",
      run: () => void document.execCommand("cut"),
    },
    {
      type: "action",
      label: "Copy",
      run: () => void document.execCommand("copy"),
    },
    {
      type: "action",
      label: "Paste",
      run: () => void document.execCommand("paste"),
    },
    { type: "separator" },
    {
      type: "action",
      label: "Go to Definition",
      shortcut: "F12",
      disabled: !hasLsp,
      run: () => void executeCommand("editor.action.revealDefinition"),
    },
    {
      type: "action",
      label: "Go to References",
      shortcut: "Shift-F12",
      disabled: !hasLsp,
      run: () => void executeCommand("editor.action.goToReferences"),
    },
    {
      type: "action",
      label: "Rename Symbol",
      shortcut: "F2",
      disabled: !hasLsp,
      run: () => void executeCommand("editor.action.rename"),
    },
    {
      type: "action",
      label: "Format Document",
      shortcut: "Shift-Alt-f",
      disabled: !hasLsp,
      run: () => void executeCommand("editor.action.formatDocument"),
    },
  ]

  if (hasLsp) {
    items.push({ type: "separator" })
    if (loadingActions) {
      items.push({
        type: "action",
        label: "Quick Fix… (loading)",
        disabled: true,
        run: () => {},
      })
    } else if (codeActions.length === 0) {
      items.push({
        type: "action",
        label: "Quick Fix…",
        disabled: true,
        run: () => {},
      })
    } else {
      for (const action of codeActions) {
        items.push({
          type: "action",
          label: action.title,
          run: () => {
            if (view) void applyCodeAction(view, action)
            onClose()
          },
        })
      }
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[300] min-w-[12rem] rounded border border-[var(--jet-border)] bg-[var(--jet-panel-raised)] py-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) =>
        item.type === "separator" ? (
          <div key={`sep-${i}`} className="my-1 border-t border-[var(--jet-border)]" />
        ) : (
          <button
            key={item.label + i}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className="flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[length:var(--jet-fs-base)] text-[var(--jet-text)] hover:bg-[var(--jet-hover)] disabled:opacity-40"
            onClick={() => {
              if (item.disabled) return
              item.run()
              onClose()
            }}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="text-[length:var(--jet-fs-xs)] text-[var(--jet-text-muted)]">{item.shortcut}</span>
            ) : null}
          </button>
        ),
      )}
    </div>
  )
}
