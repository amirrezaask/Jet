import type { ReactNode } from "react"
import { UniversalCaretLayer } from "../motion/UniversalCaretLayer.js"

/**
 * Full-viewport app chrome. Resizable splits live in {@link WorkspaceShell} and
 * {@link PanelDock} — not here (a single-panel group caused stray edge handles).
 */
export function AppShell({
  children,
  footer,
  titleBar,
}: {
  children: ReactNode
  footer?: ReactNode
  titleBar?: ReactNode
}) {
  return (
    <div
      className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
      data-jet-app-shell
      data-jet-universal-caret
    >
      <UniversalCaretLayer />
      {titleBar}
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {footer}
    </div>
  )
}
