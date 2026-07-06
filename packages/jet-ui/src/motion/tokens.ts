import {
  JET_RATE_HOT,
  JET_RATE_MENU,
  JET_RATE_SLOW_MENU,
  JET_RATE_SCROLL,
  JET_RATE_ENTITY,
  JET_RATE_THEME,
} from "@jet/shared"

export {
  JET_RATE_HOT,
  JET_RATE_MENU,
  JET_RATE_SLOW_MENU,
  JET_RATE_SCROLL,
  JET_RATE_ENTITY,
  JET_RATE_THEME,
}

export const jetMotion = {
  duration: {
    hot: 0.19,
    fast: 0.18,
    overlay: 0.2,
    panel: 0.22,
    slowMenu: 0.28,
    scroll: 0.14,
    entity: 0.35,
    overlayExit: 0.15,
  },
  css: {
    hot: "var(--jet-motion-hot)",
    fast: "var(--jet-motion-fast)",
    menu: "var(--jet-motion-menu)",
    overlay: "var(--jet-motion-overlay)",
    panel: "var(--jet-motion-panel)",
    slowMenu: "var(--jet-motion-slow-menu)",
    scroll: "var(--jet-motion-scroll)",
    entity: "var(--jet-motion-entity)",
    squishScale: "var(--jet-motion-squish-scale)",
  },
  squishScale: 0.9,
  /** Fixed-duration overlay transition approximating RAD menu rate (N=70). */
  overlayTransition: { duration: 0.2, ease: "easeOut" as const },
  quickFade: { duration: 0.12, ease: "easeOut" as const },
  tabGhostTransition: { duration: 0.2, ease: "easeOut" as const },
  overlayEnter: {
    initial: { opacity: 0, scale: 0.9, filter: "blur(4px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
    exit: { opacity: 0, scale: 0.9, filter: "blur(2px)" },
    transition: { duration: 0.2, ease: "easeOut" as const },
  },
  overlayEnterTop: {
    initial: { opacity: 0, scale: 0.9, y: -8, filter: "blur(4px)" },
    animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, scale: 0.9, y: -4, filter: "blur(2px)" },
    transition: { duration: 0.2, ease: "easeOut" as const },
  },
}

export const jetPressClass = "jet-press"
export const jetInteractiveRowClass = "jet-interactive-row"
export const jetFocusRingClass = "jet-focus-ring"
export const jetDisabledClass = "jet-disabled"
export const jetScrollFadeClass = "jet-scroll-fade"

export const jetOverlayEnterClass = "jet-overlay-enter"

export const jetOverlayContentClass =
  "jet-overlay-enter duration-[var(--jet-motion-overlay)] data-[state=closed]:duration-[var(--jet-motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90"

export const jetPopoverContentClass =
  "jet-overlay-enter duration-[var(--jet-motion-overlay)] data-[state=closed]:duration-[var(--jet-motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-90"
