import { useRef } from "react"

/** Stable ref that always holds the latest value — avoids effect rebinds on prop changes. */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value
  return ref
}
