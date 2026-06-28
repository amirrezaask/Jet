export const jetMotion = {
  fastSpring: { type: "spring" as const, stiffness: 500, damping: 38 },
  softSpring: { type: "spring" as const, stiffness: 260, damping: 28 },
  quickFade: { duration: 0.12, ease: "easeOut" as const },
}
