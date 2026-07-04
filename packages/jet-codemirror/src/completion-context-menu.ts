import { type Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view"
import { completionStatus } from "@codemirror/autocomplete"
import {
  CONTEXT_MENU_ITEM_SURFACE_CLASS,
  CONTEXT_MENU_SURFACE_CLASS,
} from "./menu-surface.js"

export const completionContextMenuClass = "jet-completion-context-menu"

function patchCompletionTooltip(): void {
  const tooltip = document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")
  if (!tooltip) return
  tooltip.dataset.jetCompletionMenu = ""
  tooltip.dataset.slot = "context-menu-content"
  for (const cls of CONTEXT_MENU_SURFACE_CLASS.split(/\s+/)) {
    tooltip.classList.add(cls)
  }
  tooltip.querySelectorAll<HTMLElement>("li[role=option]").forEach(item => {
    item.dataset.slot = "context-menu-item"
    for (const cls of CONTEXT_MENU_ITEM_SURFACE_CLASS.split(/\s+/)) {
      item.classList.add(cls)
    }
  })
}

function clearCompletionTooltipPatch(): void {
  const tooltip = document.querySelector<HTMLElement>(".cm-tooltip-autocomplete")
  if (!tooltip) return
  delete tooltip.dataset.jetCompletionMenu
}

export function completionContextMenuTheme(): Extension {
  return EditorView.theme({
    ".cm-tooltip-autocomplete": {
      padding: "0",
      border: "none",
      backgroundColor: "transparent",
    },
    ".cm-tooltip-autocomplete > ul": {
      margin: "0",
      padding: "0",
      listStyle: "none",
      maxHeight: "20rem",
      overflowY: "auto",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    ".cm-tooltip-autocomplete .cm-completionDetail": {
      marginLeft: "auto",
      paddingLeft: "0.5rem",
      fontSize: "0.75rem",
      color: "var(--muted-foreground)",
      fontStyle: "normal",
    },
  })
}

export function completionContextMenuPlugin(): Extension {
  return ViewPlugin.fromClass(
    class {
      raf = 0
      constructor(view: EditorView) {
        this.schedule(view)
      }
      update(update: ViewUpdate) {
        const was = completionStatus(update.startState)
        const now = completionStatus(update.state)
        if (was !== now || now != null) this.schedule(update.view)
      }
      schedule(view: EditorView) {
        if (this.raf) cancelAnimationFrame(this.raf)
        this.raf = requestAnimationFrame(() => {
          this.raf = 0
          if (completionStatus(view.state) != null) patchCompletionTooltip()
          else clearCompletionTooltipPatch()
        })
      }
      destroy() {
        if (this.raf) cancelAnimationFrame(this.raf)
        clearCompletionTooltipPatch()
      }
    },
  )
}
