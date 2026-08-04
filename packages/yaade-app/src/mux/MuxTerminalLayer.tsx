import {
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react"

export type MuxTerminalSlotBox = {
  top: number
  left: number
  width: number
  height: number
}

function slotSelector(ptyTabId: string): string {
  // tab ids are terminal:… — escape for querySelector
  const escaped =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(ptyTabId)
      : ptyTabId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  return `[data-yaade-mux-terminal-slot="${escaped}"]`
}

/**
 * Keep terminal hosts mounted across PanelDock remounts (split/retile/DnD).
 * Slots are empty placeholders in the dock; this layer paints terminals over them.
 */
export function useMuxTerminalSlotBoxes(
  containerRef: RefObject<HTMLElement | null>,
  ptyTabIds: string[],
  /** Bump when panel tree structure changes so we re-query slots. */
  layoutEpoch: string | number,
): Map<string, MuxTerminalSlotBox> {
  const [boxes, setBoxes] = useState(() => new Map<string, MuxTerminalSlotBox>())
  const idKey = ptyTabIds.join("\0")

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) {
      setBoxes(new Map())
      return
    }

    const sync = () => {
      const cbox = container.getBoundingClientRect()
      const next = new Map<string, MuxTerminalSlotBox>()
      for (const id of ptyTabIds) {
        const slot = container.querySelector<HTMLElement>(slotSelector(id))
        if (!slot) continue
        const r = slot.getBoundingClientRect()
        if (r.width < 1 || r.height < 1) continue
        next.set(id, {
          top: r.top - cbox.top,
          left: r.left - cbox.left,
          width: r.width,
          height: r.height,
        })
      }
      setBoxes(prev => {
        if (prev.size === next.size) {
          let same = true
          for (const [id, box] of next) {
            const old = prev.get(id)
            if (
              !old ||
              old.top !== box.top ||
              old.left !== box.left ||
              old.width !== box.width ||
              old.height !== box.height
            ) {
              same = false
              break
            }
          }
          if (same) return prev
        }
        return next
      })
    }

    sync()
    const ro = new ResizeObserver(() => sync())
    ro.observe(container)
    for (const id of ptyTabIds) {
      const slot = container.querySelector<HTMLElement>(slotSelector(id))
      if (slot) ro.observe(slot)
    }
    const mo = new MutationObserver(() => sync())
    mo.observe(container, { childList: true, subtree: true })
    window.addEventListener("resize", sync)
    return () => {
      ro.disconnect()
      mo.disconnect()
      window.removeEventListener("resize", sync)
    }
  }, [containerRef, idKey, layoutEpoch, ptyTabIds])

  return boxes
}

export function MuxTerminalLayer(props: {
  ptyTabIds: string[]
  boxes: Map<string, MuxTerminalSlotBox>
  focusedPtyTabId: string | null
  renderTerminal: (ptyTabId: string, focused: boolean) => ReactNode
}) {
  const { ptyTabIds, boxes, focusedPtyTabId, renderTerminal } = props
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      data-yaade-mux-terminal-layer=""
    >
      {ptyTabIds.map(id => {
        const box = boxes.get(id)
        const focused = focusedPtyTabId === id
        return (
          <div
            key={id}
            data-yaade-mux-terminal-host={id}
            data-yaade-tab-slot=""
            data-yaade-tab-active={focused ? "" : undefined}
            data-focused={focused ? "" : undefined}
            className={
              box
                ? "pointer-events-auto absolute overflow-hidden"
                : "pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
            }
            style={
              box
                ? {
                    top: box.top,
                    left: box.left,
                    width: box.width,
                    height: box.height,
                  }
                : undefined
            }
          >
            {renderTerminal(id, focused)}
          </div>
        )
      })}
    </div>
  )
}
