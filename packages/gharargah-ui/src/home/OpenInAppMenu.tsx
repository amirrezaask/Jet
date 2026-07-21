import { useState, type MouseEvent } from "react"
import {
  AppWindow,
  Code2,
  ExternalLink,
  SquareTerminal,
  type LucideIcon,
} from "lucide-react"
import { Button } from "../components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js"
import { cn } from "@/lib/utils.js"
import { CursorIcon, type Icon } from "../agents/composer/Icons.js"

export type OpenInAppId = "vscode" | "sublime" | "cursor" | "ghostty" | "kitty"

export type OpenInAppTarget = {
  id: OpenInAppId
  label: string
  Icon: LucideIcon | Icon
}

export const OPEN_IN_APP_TARGETS: OpenInAppTarget[] = [
  { id: "vscode", label: "VS Code", Icon: Code2 },
  { id: "sublime", label: "Sublime Text", Icon: AppWindow },
  { id: "cursor", label: "Cursor", Icon: CursorIcon },
  { id: "ghostty", label: "Ghostty", Icon: SquareTerminal },
  { id: "kitty", label: "Kitty", Icon: SquareTerminal },
]

export type OpenInAppMenuProps = {
  rootUri: string
  onOpenInApp: (rootUri: string, appId: OpenInAppId) => void
  align?: "start" | "center" | "end"
  className?: string
  /** Optional test / aria id suffix for modal vs home. */
  "data-gharargah-open-in-app"?: string
}

export function OpenInAppMenu(props: OpenInAppMenuProps) {
  const {
    rootUri,
    onOpenInApp,
    align = "end",
    className,
    "data-gharargah-open-in-app": dataAttr = "true",
  } = props
  // Controlled open so Tauri e2e synthetic `.click()` still opens the menu.
  const [open, setOpen] = useState(false)

  const openMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(true)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          data-gharargah-open-in-app={dataAttr}
          className={cn("shrink-0", className)}
          title="Open in…"
          aria-label="Open project in external app"
          onClick={openMenu}
        >
          <ExternalLink className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={{ top: 42, right: 8, bottom: 8, left: 8 }}
        className="[WebkitAppRegion:no-drag]"
        data-gharargah-open-in-app-menu
      >
        <DropdownMenuGroup>
          {OPEN_IN_APP_TARGETS.map(target => (
            <DropdownMenuItem
              key={target.id}
              data-gharargah-open-in-app-item={target.id}
              onSelect={() => onOpenInApp(rootUri, target.id)}
            >
              <target.Icon className="size-4" />
              {target.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
