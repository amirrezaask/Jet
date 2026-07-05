import type { ReactNode } from "react"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar.js"

export type JetTitleBarAction = {
  id: string
  label: string
  shortcut?: string
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
}

export type JetTitleBarCheckboxAction = {
  kind: "checkbox"
  id: string
  label: string
  shortcut?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}

export type JetTitleBarMenu = {
  id: string
  label: string
  items: Array<JetTitleBarAction | JetTitleBarCheckboxAction | { kind: "separator" }>
}

/**
 * Custom window titlebar for macOS `titleBarStyle: 'hiddenInset'`.
 * Left padding reserves 78px for native traffic lights.
 * The row is drag-region (WebkitAppRegion: 'drag'); interactive parts opt out with 'no-drag'.
 */
export function JetTitleBar({
  menus,
  center,
  right,
}: {
  menus: JetTitleBarMenu[]
  center?: ReactNode
  right?: ReactNode
}) {
  return (
    <div
      data-jet-titlebar
      className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background pr-1 text-xs select-none"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div aria-hidden data-jet-traffic-light-spacer />
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <Menubar className="h-7 border-0 bg-transparent p-0 shadow-none">
          {menus.map(menu => (
            <MenubarMenu key={menu.id}>
              <MenubarTrigger className="px-2 py-0.5 text-xs">{menu.label}</MenubarTrigger>
              <MenubarContent>
                {menu.items.map((item, i) =>
                  "kind" in item && item.kind === "separator" ? (
                    <MenubarSeparator key={`sep-${i}`} />
                  ) : "kind" in item && item.kind === "checkbox" ? (
                    <MenubarCheckboxItem
                      key={item.id}
                      checked={item.checked}
                      disabled={item.disabled}
                      onCheckedChange={item.onCheckedChange}
                    >
                      {item.label}
                      {item.shortcut ? <MenubarShortcut>{item.shortcut}</MenubarShortcut> : null}
                    </MenubarCheckboxItem>
                  ) : (
                    <MenubarItem
                      key={item.id}
                      onSelect={item.onSelect}
                      disabled={item.disabled}
                      variant={item.destructive ? "destructive" : "default"}
                    >
                      {item.label}
                      {item.shortcut ? <MenubarShortcut>{item.shortcut}</MenubarShortcut> : null}
                    </MenubarItem>
                  ),
                )}
              </MenubarContent>
            </MenubarMenu>
          ))}
        </Menubar>
      </div>
      <div
        className="min-w-0 flex-1 truncate text-center text-muted-foreground"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {center}
      </div>
      <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>{right}</div>
    </div>
  )
}
