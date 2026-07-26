import { useEffect, useRef } from "react"
import { useSyncLayout } from "@legendapp/list/react"

/** Notify LegendList to remeasure after in-row height changes (expand/collapse, streaming). */
export function useTimelineItemLayoutSync(deps: readonly unknown[]): void {
  const syncLayout = useSyncLayout()
  const syncLayoutRef = useRef(syncLayout)
  syncLayoutRef.current = syncLayout

  useEffect(() => {
    let frame = 0
    frame = requestAnimationFrame(() => {
      syncLayoutRef.current()
    })
    return () => {
      cancelAnimationFrame(frame)
    }
    // Caller passes explicit height-affecting deps; syncLayout is stable via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional dep spread
  }, deps)
}
