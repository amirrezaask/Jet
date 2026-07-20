import { useEffect, useState } from "react"
import { onReducedMotionChange, prefersReducedMotion } from "@gharargah/shared"

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion())

  useEffect(() => onReducedMotionChange(setReduced), [])

  return reduced
}
