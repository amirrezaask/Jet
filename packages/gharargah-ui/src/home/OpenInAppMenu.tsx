import { useState, type MouseEvent } from "react"
import { ChevronDown } from "lucide-react"
import { Button } from "../components/ui/button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.js"
import { cn } from "@/lib/utils.js"
import { openInAppIcons } from "./open-in-app-icons/index.js"

export type OpenInAppId =
  | "vscode"
  | "cursor"
  | "emacs"
  | "sublime"
  | "zed"
  | "finder"
  | "terminal"
  | "kitty"
  | "ghostty"
  | "xcode"
  | "intellij"

export type OpenInAppTarget = {
  id: OpenInAppId
  label: string
  icon: string
}

const LAST_APP_KEY = "gharargah-open-in-app-last"

export const OPEN_IN_APP_TARGETS: OpenInAppTarget[] = [
  { id: "vscode", label: "VS Code", icon: openInAppIcons.vscode },
  { id: "cursor", label: "Cursor", icon: openInAppIcons.cursor },
  { id: "emacs", label: "Emacs", icon: openInAppIcons.emacs },
  { id: "sublime", label: "Sublime Text", icon: openInAppIcons.sublime },
  { id: "zed", label: "Zed", icon: openInAppIcons.zed },
  { id: "finder", label: "Finder", icon: openInAppIcons.finder },
  { id: "terminal", label: "Terminal", icon: openInAppIcons.terminal },
  { id: "kitty", label: "Kitty", icon: openInAppIcons.kitty },
  { id: "ghostty", label: "Ghostty", icon: openInAppIcons.ghostty },
  { id: "xcode", label: "Xcode", icon: openInAppIcons.xcode },
  { id: "intellij", label: "IntelliJ IDEA", icon: openInAppIcons.intellij },
]

function readLastAppId(): OpenInAppId {
  try {
    const raw = localStorage.getItem(LAST_APP_KEY)
    if (raw && OPEN_IN_APP_TARGETS.some(t => t.id === raw)) {
      return raw as OpenInAppId
    }
  } catch {
    /* ignore */
  }
  return "sublime"
}

function writeLastAppId(id: OpenInAppId) {
  try {
    localStorage.setItem(LAST_APP_KEY, id)
  } catch {
    /* ignore */
  }
}

function AppIcon(props: { src: string; className?: string }) {
  return (
    <img
      src={props.src}
      alt=""
      width={24}
      height={24}
      draggable={false}
      className={cn("size-6 shrink-0 rounded-[5px] object-cover", props.className)}
      aria-hidden
    />
  )
}

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
  const [lastAppId, setLastAppId] = useState<OpenInAppId>(readLastAppId)

  const lastTarget =
    OPEN_IN_APP_TARGETS.find(t => t.id === lastAppId) ?? OPEN_IN_APP_TARGETS[0]!

  const openMenu = (e: MouseEvent) => {
    e.stopPropagation()
    setOpen(true)
  }

  const selectApp = (id: OpenInAppId) => {
    setLastAppId(id)
    writeLastAppId(id)
    onOpenInApp(rootUri, id)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-gharargah-open-in-app={dataAttr}
          className={cn(
            "h-7 shrink-0 gap-1 rounded-md border-border/70 bg-muted/40 px-1.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
            className,
          )}
          title={`Open in ${lastTarget.label}`}
          aria-label="Open project in external app"
          onClick={openMenu}
        >
          <AppIcon src={lastTarget.icon} className="size-4 rounded-[4px]" />
          <ChevronDown className="size-3 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        collisionPadding={{ top: 42, right: 8, bottom: 8, left: 8 }}
        className="min-w-[12.5rem] rounded-xl border-border/60 p-1.5 shadow-xl [WebkitAppRegion:no-drag]"
        data-gharargah-open-in-app-menu
      >
        <DropdownMenuGroup>
          {OPEN_IN_APP_TARGETS.map(target => (
            <DropdownMenuItem
              key={target.id}
              data-gharargah-open-in-app-item={target.id}
              className="gap-2.5 rounded-lg px-2 py-1.5 text-sm"
              onSelect={() => selectApp(target.id)}
            >
              <AppIcon src={target.icon} />
              <span className="truncate">{target.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
