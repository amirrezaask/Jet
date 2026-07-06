export const jetMotion = {
  duration: {
    fast: 0.15,
    overlay: 0.2,
    panel: 0.22,
    overlayExit: 0.15,
  },
  css: {
    fast: "var(--jet-motion-fast)",
    overlay: "var(--jet-motion-overlay)",
    panel: "var(--jet-motion-panel)",
  },
  tabGhostSpring: { type: "spring" as const, stiffness: 400, damping: 32 },
  fastSpring: { type: "spring" as const, stiffness: 500, damping: 38 },
  softSpring: { type: "spring" as const, stiffness: 260, damping: 28 },
  quickFade: { duration: 0.12, ease: "easeOut" as const },
  overlayEnter: {
    initial: { opacity: 0, scale: 0.96, filter: "blur(4px)" },
    animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
    exit: { opacity: 0, scale: 0.96, filter: "blur(2px)" },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
  },
  overlayEnterTop: {
    initial: { opacity: 0, scale: 0.96, y: -8, filter: "blur(4px)" },
    animate: { opacity: 1, scale: 1, y: 0, filter: "blur(0px)" },
    exit: { opacity: 0, scale: 0.96, y: -4, filter: "blur(2px)" },
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export const jetPressClass = "jet-press"

export const jetOverlayContentClass =
  "duration-[var(--jet-motion-overlay)] data-[state=closed]:duration-[var(--jet-motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96"

export const jetPopoverContentClass =
  "duration-[var(--jet-motion-overlay)] data-[state=closed]:duration-[var(--jet-motion-fast)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-96 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-96"
