/** Non-React reduced-motion probe (CodeMirror plugins, layout morph rAF). */
export function prefersReducedMotion(): boolean {
  const g = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => { matches: boolean; addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void }
  }
  if (typeof g.matchMedia !== "function") return false
  return g.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function onReducedMotionChange(listener: (reduced: boolean) => void): () => void {
  const g = globalThis as typeof globalThis & {
    matchMedia?: (query: string) => {
      matches: boolean
      addEventListener: (type: string, fn: () => void) => void
      removeEventListener: (type: string, fn: () => void) => void
    }
  }
  if (typeof g.matchMedia !== "function") return () => {}
  const mq = g.matchMedia("(prefers-reduced-motion: reduce)")
  const handler = () => listener(mq.matches)
  mq.addEventListener("change", handler)
  return () => mq.removeEventListener("change", handler)
}
