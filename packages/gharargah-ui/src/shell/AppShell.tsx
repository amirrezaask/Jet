import type { ReactNode } from "react"
import { HotGlowTracker } from "../motion/HotGlowTracker.js"
import { UniversalCaretLayer } from "../motion/UniversalCaretLayer.js"

/**
 * Full-viewport app chrome. Resizable splits live in {@link WorkspaceShell} and
 * {@link PanelDock} — not here (a single-panel group caused stray edge handles).
 * Tab bars are the top chrome; empty tab-bar space owns window drag.
 */
export function AppShell({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div
      className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-gharargah-app-shell
      data-gharargah-universal-caret
    >
      <UniversalCaretLayer />
      <HotGlowTracker />
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {footer}
    </div>
  )
}
