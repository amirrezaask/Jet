import {
  FileCode2,
  GitBranch,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react"
import type { SVGProps } from "react"
import { KeyBindingKbd } from "@/components/KeyBindingKbd.js"
import { cn } from "@/lib/utils.js"

/** Simple Icons Neovim mark — monochrome via currentColor. */
function NeovimIcon(props: SVGProps<SVGSVGElement>) {
  const { className, ...rest } = props
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
      className={cn("size-6 shrink-0 fill-current", className)}
      {...rest}
    >
      <path d="M2.214 4.954v13.615L7.655 24V10.314L3.312 3.845 2.214 4.954zm4.999 17.98l-4.557-4.548V5.136l.59-.596 3.967 5.908v12.485zm14.573-4.457l-.862.937-4.24-6.376V0l5.068 5.092.034 13.385zM7.431.001l12.998 19.835-3.637 3.637L3.787 3.683 7.43 0z" />
    </svg>
  )
}

export type MuxEmptyActionId = "terminal" | "neovim" | "git" | "editor"

export type MuxEmptyStateProps = {
  onOpenTerminal: () => void
  onOpenNeovim: () => void
  onOpenGit: () => void
  onOpenEditor: () => void
  /** Resolve a display shortcut for a command id. */
  shortcutFor?: (commandId: string) => string | undefined
}

type Tile = {
  id: MuxEmptyActionId
  label: string
  hint: string
  commandId: string
  testId: string
  onSelect: () => void
  Icon: LucideIcon | typeof NeovimIcon
}

export function MuxEmptyState(props: MuxEmptyStateProps) {
  const {
    onOpenTerminal,
    onOpenNeovim,
    onOpenGit,
    onOpenEditor,
    shortcutFor,
  } = props

  const tiles: Tile[] = [
    {
      id: "terminal",
      label: "Terminal",
      hint: "Shell pane",
      commandId: "terminal.new",
      testId: "terminal",
      onSelect: onOpenTerminal,
      Icon: SquareTerminal,
    },
    {
      id: "neovim",
      label: "Neovim",
      hint: "Vim in a PTY",
      commandId: "mux.openNeovim",
      testId: "neovim",
      onSelect: onOpenNeovim,
      Icon: NeovimIcon,
    },
    {
      id: "git",
      label: "Git",
      hint: "Status & diff",
      commandId: "mux.openGit",
      testId: "git",
      onSelect: onOpenGit,
      Icon: GitBranch,
    },
    {
      id: "editor",
      label: "Editor",
      hint: "Open a file",
      commandId: "mux.openEditor",
      testId: "editor",
      onSelect: onOpenEditor,
      Icon: FileCode2,
    },
  ]

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center p-6"
      data-yaade-mux-empty-panes=""
      role="region"
      aria-label="No panes open"
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-1.5 text-center">
          <h2 className="text-base font-medium tracking-tight text-foreground">
            Open a pane
          </h2>
          <p className="text-xs text-muted-foreground">
            Pick a starting surface for this session.
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map(tile => {
            const shortcut = shortcutFor?.(tile.commandId)
            const Icon = tile.Icon
            return (
              <button
                key={tile.id}
                type="button"
                data-yaade-mux-empty-action={tile.testId}
                aria-label={tile.label}
                onClick={tile.onSelect}
                className={cn(
                  "group/empty-tile yaade-press flex flex-col items-center gap-2.5 rounded-lg border border-border/50 bg-background/40 px-3 py-4",
                  "text-center outline-none transition-[border-color,background-color,color] duration-[var(--yaade-motion-hot)]",
                  "hover:border-border hover:bg-accent/60 hover:text-accent-foreground",
                  "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-md bg-muted/70 text-foreground",
                    "transition-colors duration-[var(--yaade-motion-hot)]",
                    "group-hover/empty-tile:bg-muted group-focus-visible/empty-tile:bg-muted",
                  )}
                  aria-hidden
                >
                  <Icon className="size-5" />
                </span>
                <span className="flex flex-col items-center gap-0.5">
                  <span className="text-xs font-medium text-foreground">
                    {tile.label}
                  </span>
                  <span className="text-3xs text-muted-foreground">
                    {tile.hint}
                  </span>
                </span>
                {shortcut ? (
                  <KeyBindingKbd
                    binding={shortcut}
                    className="opacity-70 group-hover/empty-tile:opacity-100"
                  />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
