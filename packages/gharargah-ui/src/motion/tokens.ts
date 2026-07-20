import {
  GHARARGAH_RATE_HOT,
  GHARARGAH_RATE_MENU,
  GHARARGAH_RATE_SLOW_MENU,
  GHARARGAH_RATE_SCROLL,
  GHARARGAH_RATE_ENTITY,
  GHARARGAH_RATE_THEME,
} from "@gharargah/shared"

export {
  GHARARGAH_RATE_HOT,
  GHARARGAH_RATE_MENU,
  GHARARGAH_RATE_SLOW_MENU,
  GHARARGAH_RATE_SCROLL,
  GHARARGAH_RATE_ENTITY,
  GHARARGAH_RATE_THEME,
}

export const gharargahMotion = {
  duration: {
    hot: 0.12,
    fast: 0.12,
    overlay: 0.18,
    panel: 0.22,
    slowMenu: 0.24,
    scroll: 0.14,
    entity: 0.24,
    overlayExit: 0.15,
  },
  css: {
    hot: "var(--gharargah-motion-hot)",
    fast: "var(--gharargah-motion-fast)",
    menu: "var(--gharargah-motion-menu)",
    overlay: "var(--gharargah-motion-overlay)",
    panel: "var(--gharargah-motion-panel)",
    slowMenu: "var(--gharargah-motion-slow-menu)",
    scroll: "var(--gharargah-motion-scroll)",
    entity: "var(--gharargah-motion-entity)",
    squishScale: "var(--gharargah-motion-squish-scale)",
  },
  squishScale: 0.9,
  /** Fixed-duration overlay transition approximating RAD menu rate (N=70). */
  overlayTransition: { duration: 0.18 /* overlay */, ease: "easeOut" as const },
  quickFade: { duration: 0.12, ease: "easeOut" as const },
  tabGhostTransition: { duration: 0.18 /* overlay */, ease: "easeOut" as const },
  overlayEnter: {
    initial: { opacity: 0, scale: 0.9 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.9 },
    transition: { duration: 0.18, ease: "easeOut" as const },
  },
  overlayEnterTop: {
    initial: { opacity: 0, scale: 0.9, y: -8 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.9, y: -4 },
    transition: { duration: 0.18, ease: "easeOut" as const },
  },
}

export const gharargahPressClass = "gharargah-press gharargah-hot-glow"
export const gharargahInteractiveRowClass = "gharargah-interactive-row gharargah-hot-glow"
/** RAD DrawHotEffects mouse soft-circle; usually baked into press/row/data-slots. */
export const gharargahHotGlowClass = "gharargah-hot-glow"
export const gharargahFocusRingClass = "gharargah-focus-ring"
export const gharargahDisabledClass = "gharargah-disabled"
export const gharargahScrollFadeClass = "gharargah-scroll-fade"

export const gharargahOverlayEnterClass = "gharargah-overlay-enter"

export type GharargahOverlayMotion = "instant" | "standard"

export const gharargahOverlayContentClass = "gharargah-dialog-motion"

export const gharargahPopoverContentClass =
  "duration-[var(--gharargah-motion-menu)] ease-[var(--gharargah-ease-out)] data-[state=closed]:duration-[var(--gharargah-motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"

export const gharargahMenuContentClass =
  "duration-[var(--gharargah-motion-menu)] ease-[var(--gharargah-ease-out)] data-[state=closed]:duration-[var(--gharargah-motion-fast)]"
