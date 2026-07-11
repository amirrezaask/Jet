import { useEffect } from "react"

/** Matches globals.css hot-glow targets (RAD DrawHotEffects soft circle). */
const HOT_GLOW_SELECTOR = [
  ".jet-hot-glow",
  ".jet-press",
  ".jet-interactive-row",
  '[data-slot="button"]',
  '[data-slot="tabs-trigger"]',
  '[data-slot="toggle"]',
  '[data-slot="toggle-group-item"]',
  '[data-slot="command-item"]',
  '[data-slot="item"]',
  '[data-slot="sidebar-menu-button"]',
  '[data-slot="sidebar-menu-sub-button"]',
  '[data-slot="sidebar-menu-action"]',
  '[data-slot="sidebar-group-action"]',
  '[data-slot="sidebar-trigger"]',
  '[data-slot="dialog-trigger"]',
  '[data-slot="dialog-close"]',
  '[data-slot="drawer-trigger"]',
  '[data-slot="drawer-close"]',
  '[data-slot="popover-trigger"]',
  '[data-slot="context-menu-item"]',
  '[data-slot="context-menu-sub-trigger"]',
  '[data-slot="context-menu-checkbox-item"]',
  '[data-slot="context-menu-radio-item"]',
  '[data-slot="dropdown-menu-item"]',
  '[data-slot="dropdown-menu-sub-trigger"]',
  '[data-slot="dropdown-menu-checkbox-item"]',
  '[data-slot="dropdown-menu-radio-item"]',
  '[data-slot="menubar-trigger"]',
  '[data-slot="menubar-item"]',
  '[data-slot="menubar-sub-trigger"]',
  '[data-slot="menubar-checkbox-item"]',
  '[data-slot="menubar-radio-item"]',
  '[data-slot="accordion-trigger"]',
  '[data-slot="collapsible-trigger"]',
  '[data-slot="select-item"]',
].join(", ")

const SKIP_SELECTOR = ".cm-content, .cm-editor, .xterm"

function findHotGlowTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  if (node.closest(SKIP_SELECTOR)) return null
  return node.closest<HTMLElement>(HOT_GLOW_SELECTOR)
}

/**
 * Sets `--jet-hot-x/y` on the hovered interactive widget so CSS can draw the
 * RAD-style mouse-follow soft circle (clipped to that box).
 * Listens on `document` so portaled menus (menubar/context/dropdown) work too.
 */
export function HotGlowTracker() {
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const target = findHotGlowTarget(event.target)
      if (!target) return
      const rect = target.getBoundingClientRect()
      target.style.setProperty("--jet-hot-x", `${event.clientX - rect.left}px`)
      target.style.setProperty("--jet-hot-y", `${event.clientY - rect.top}px`)
    }

    document.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      document.removeEventListener("pointermove", onMove)
    }
  }, [])

  return null
}
