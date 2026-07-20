import { useEffect } from "react"

/** Matches globals.css hot-glow targets (RAD DrawHotEffects soft circle). */
const HOT_GLOW_SELECTOR = [
  "\.gharargah-hot-glow",
  "\.gharargah-press",
  "\.gharargah-interactive-row",
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
 * Sets `--gharargah-hot-x/y` on the hovered interactive widget so CSS can draw the
 * RAD-style mouse-follow soft circle (clipped to that box).
 * Listens on `document` so portaled menus (menubar/context/dropdown) work too.
 */
export function HotGlowTracker() {
  useEffect(() => {
    let frame: number | null = null
    let fallback: number | null = null
    let pending: { target: HTMLElement; x: number; y: number } | null = null
    let activeTarget: HTMLElement | null = null

    const flush = () => {
      frame = null
      if (fallback != null) window.clearTimeout(fallback)
      fallback = null
      const update = pending
      pending = null
      if (!update || !update.target.isConnected) return
      const rect = update.target.getBoundingClientRect()
      if (activeTarget !== update.target) {
        activeTarget?.removeAttribute("data-gharargah-hot-active")
        activeTarget = update.target
        activeTarget.setAttribute("data-gharargah-hot-active", "")
      }
      update.target.style.setProperty("--gharargah-hot-x", `${update.x - rect.left}px`)
      update.target.style.setProperty("--gharargah-hot-y", `${update.y - rect.top}px`)
    }

    const onMove = (event: PointerEvent) => {
      const target = findHotGlowTarget(event.target)
      if (!target) {
        activeTarget?.removeAttribute("data-gharargah-hot-active")
        activeTarget = null
        pending = null
        return
      }
      pending = { target, x: event.clientX, y: event.clientY }
      if (frame == null) {
        frame = requestAnimationFrame(flush)
        fallback = window.setTimeout(flush, 32)
      }
    }

    document.addEventListener("pointermove", onMove, { passive: true })
    return () => {
      document.removeEventListener("pointermove", onMove)
      if (frame != null) cancelAnimationFrame(frame)
      if (fallback != null) window.clearTimeout(fallback)
      activeTarget?.removeAttribute("data-gharargah-hot-active")
    }
  }, [])

  return null
}
