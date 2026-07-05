import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

function focusElement(el: HTMLElement | null | undefined): void {
  if (!el) return
  requestAnimationFrame(() => el.focus())
}

/** Focus `ref` when `active` is true, including after async mount (popover anchor, tab switch). */
export function useAutoFocus<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null)

  const setRef = useCallback(
    (el: T | null) => {
      ref.current = el
      if (active) focusElement(el)
    },
    [active],
  )

  useLayoutEffect(() => {
    if (active) focusElement(ref.current)
  }, [active])

  return setRef
}
