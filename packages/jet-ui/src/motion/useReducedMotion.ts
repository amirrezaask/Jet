import { useEffect, useState } from "react"
import { onReducedMotionChange, prefersReducedMotion } from "@jet/shared"

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => prefersReducedMotion())

  useEffect(() => onReducedMotionChange(setReduced), [])

  return reduced
}
