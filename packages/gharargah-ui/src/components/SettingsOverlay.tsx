import type { GharargahTheme } from "@gharargah/shared"
import {
  Bell,
  Brush,
  Cable,
  LayoutGrid,
  PanelLeft,
  PanelsTopLeft,
  RotateCcw,
  SlidersHorizontal,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button.js"
import { Checkbox } from "@/components/ui/checkbox.js"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import { Input } from "@/components/ui/input.js"
import { ScrollArea } from "@/components/ui/scroll-area.js"
import { Separator } from "@/components/ui/separator.js"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { SettingsField } from "@/components/SettingsField.js"
import { themePreviewSwatches } from "@/theme/bundled.js"
import {
  DEFAULT_MONO_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
} from "../theme/appearance-defaults.js"

export type SessionLayout = "cards" | "tabs" | "sidebar"

export type JetAppearanceSettings = {
  themeId: string
  fontSize: number
  /** Mission Control cards, browser-style tabs, or sidebar navigation. */
  sessionLayout: SessionLayout
  /** Whether the Mission Control sidebar is collapsed (icon mode). */
  sidebarCollapsed: boolean
  /** Sidebar expanded width in px (clamped 240–480). */
  sidebarWidth: number
  /**
   * Project filter in sidebar layout (`null` = All).
   * Persisted as absolute project path (stable across reloads).
   */
  sidebarProjectFilterPath: string | null
}

export type SettingsOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: GharargahTheme[]
  settings: JetAppearanceSettings
  onSettingsChange: (settings: JetAppearanceSettings) => void
  onReset: () => void
  serverConnection?: DesktopServerConnection | null
  onServerConnect?: (
    serverUrl: string | null,
  ) => Promise<DesktopServerConnection>
  notificationPrefs?: import("@gharargah/shared").NotificationPreferences | null
  onNotificationPrefsChange?: (
    patch: Partial<import("@gharargah/shared").NotificationPreferences>,
  ) => void
}

export type DesktopServerConnection = {
  activeUrl: string
  localUrl: string
  mode: "local" | "remote"
  startupError?: string | null
}

export type GharargahDesktopBridge = {
  windowChrome?: Readonly<{
    customTitlebar: true
    platform: "darwin" | "win32" | "linux"
    titlebarHeight: number
    trafficLights: boolean
  }>
  getServerConnection: () => Promise<DesktopServerConnection>
  connectToServer: (
    serverUrl: string | null,
  ) => Promise<DesktopServerConnection>
}

declare global {
  interface Window {
    gharargahDesktop?: GharargahDesktopBridge
  }
}

function parseNumber(
  value: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function settingPatch(
  settings: JetAppearanceSettings,
  patch: Partial<JetAppearanceSettings>,
): JetAppearanceSettings {
  return { ...settings, ...patch }
}

function ThemeButton({
  theme,
  active,
  onSelect,
}: {
  theme: GharargahTheme
  active: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      data-gharargah-theme-option={theme.id}
      aria-pressed={active}
      onClick={onSelect}
      className="h-auto min-h-12 w-full justify-start gap-3 px-3 py-2 text-left"
    >
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-current">
          {theme.name}
        </span>
        <span className="mt-1 block font-mono text-3xs text-muted-foreground">
          {theme.scheme ?? "dark"}
        </span>
      </span>
      <span className="flex w-28 shrink-0 overflow-hidden rounded-sm border border-border">
        {themePreviewSwatches(theme)
          .slice(0, 10)
          .map((color, index) => (
            <span
              key={`${theme.id}:${index}:${color}`}
              aria-hidden
              className="h-5 flex-1"
              style={{ backgroundColor: color }}
            />
          ))}
      </span>
    </Button>
  )
}

type SettingsCategory = "general" | "appearance" | "notifications" | "server"

const SETTINGS_CATEGORIES = {
  general: {
    label: "General",
    description: "Choose how sessions are arranged in Mission Control.",
    icon: SlidersHorizontal,
  },
  appearance: {
    label: "Appearance",
    description: "Tune the theme and typography across the app.",
    icon: Brush,
  },
  notifications: {
    label: "Notifications",
    description: "Choose which events can interrupt you.",
    icon: Bell,
  },
  server: {
    label: "Server",
    description: "Manage the host that this desktop app connects to.",
    icon: Cable,
  },
} satisfies Record<
  SettingsCategory,
  { label: string; description: string; icon: typeof SlidersHorizontal }
>

function SettingsSectionHeader({ category }: { category: SettingsCategory }) {
  const item = SETTINGS_CATEGORIES[category]
  return (
    <header className="flex flex-col gap-1">
      <h2 className="text-base font-semibold tracking-tight text-foreground">
        {item.label}
      </h2>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {item.description}
      </p>
    </header>
  )
}

function useCompactSettingsNavigation(): boolean {
  const [compact, setCompact] = useState(() =>
    window.matchMedia("(max-width: 767px)").matches,
  )

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const sync = () => setCompact(media.matches)
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  return compact
}

export function SettingsOverlay({
  open,
  onOpenChange,
  themes,
  settings,
  onSettingsChange,
  onReset,
  serverConnection,
  onServerConnect,
  notificationPrefs: notificationPrefsProp,
  onNotificationPrefsChange: onNotificationPrefsChangeProp,
}: SettingsOverlayProps) {
  const [localPrefs, setLocalPrefs] = useState<
    import("@gharargah/shared").NotificationPreferences | null
  >(null)
  const [remoteServerUrl, setRemoteServerUrl] = useState("")
  const [serverPending, setServerPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [category, setCategory] = useState<SettingsCategory>("general")
  const compactNavigation = useCompactSettingsNavigation()

  useEffect(() => {
    if (!open || !serverConnection) return
    setRemoteServerUrl(
      serverConnection.mode === "remote" ? serverConnection.activeUrl : "",
    )
    setServerError(serverConnection.startupError ?? null)
  }, [open, serverConnection])

  useEffect(() => {
    if (!open || notificationPrefsProp) return
    const api = window.gharargah?.notifications
    if (!api) return
    void api
      .getPreferences()
      .then(setLocalPrefs)
      .catch(() => {})
  }, [open, notificationPrefsProp])

  const notificationPrefs = notificationPrefsProp ?? localPrefs
  const onNotificationPrefsChange =
    onNotificationPrefsChangeProp ??
    ((patch: Partial<import("@gharargah/shared").NotificationPreferences>) => {
      const api = window.gharargah?.notifications
      if (!api) return
      void api.setPreferences(patch).then(setLocalPrefs)
    })

  const connectServer = async (serverUrl: string | null) => {
    if (!onServerConnect || serverPending) return
    setServerPending(true)
    setServerError(null)
    try {
      await onServerConnect(serverUrl)
    } catch (error) {
      setServerError(error instanceof Error ? error.message : String(error))
    } finally {
      setServerPending(false)
    }
  }

  const categories: SettingsCategory[] = ["general", "appearance"]
  if (notificationPrefs) categories.push("notifications")
  if (serverConnection && onServerConnect) categories.push("server")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-gharargah-settings-overlay=""
        showCloseButton={false}
        size="wide"
        className="h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-0 sm:h-[min(44rem,calc(100dvh-2rem))] sm:max-w-[50rem]"
        style={{
          width: "min(50rem, calc(100vw - 2rem))",
          maxWidth: "min(50rem, calc(100vw - 2rem))",
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure session layout, appearance, notifications, and server
            connection.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={category}
          onValueChange={(value) => setCategory(value as SettingsCategory)}
          orientation={compactNavigation ? "horizontal" : "vertical"}
          className="min-h-0 flex-1 flex-col gap-0 md:flex-row"
          data-gharargah-settings-tabs=""
        >
          <aside className="flex shrink-0 flex-col border-b border-border bg-muted/20 md:w-52 md:border-r md:border-b-0">
            <div className="flex h-14 items-center justify-between gap-3 px-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold tracking-tight text-foreground">
                  Settings
                </div>
                <div className="text-3xs text-muted-foreground">
                  Gharargah preferences
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onReset}
                  aria-label="Reset appearance"
                  className="md:hidden"
                >
                  <RotateCcw />
                </Button>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close settings"
                  >
                    <X />
                  </Button>
                </DialogClose>
              </div>
            </div>
            <Separator />
            <TabsList
              variant="line"
              aria-label="Settings categories"
              className="scroll-fade-x flex h-auto w-full justify-start overflow-x-auto rounded-none p-2 md:flex-1 md:flex-col md:justify-start md:overflow-visible"
            >
              {categories.map((id) => {
                const item = SETTINGS_CATEGORIES[id]
                const Icon = item.icon
                return (
                  <TabsTrigger
                    key={id}
                    value={id}
                    data-gharargah-settings-category={id}
                    className="h-9 flex-none px-3 md:w-full"
                  >
                    <Icon aria-hidden />
                    {item.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
            <div className="hidden p-3 md:block">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="w-full justify-start"
              >
                <RotateCcw data-icon="inline-start" />
                Reset appearance
              </Button>
            </div>
          </aside>

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TabsContent
              value="general"
              className="min-h-0 flex-1"
              data-gharargah-settings-panel="general"
            >
              <ScrollArea className="size-full">
                <section className="flex flex-col gap-6 p-5 sm:p-7">
                  <SettingsSectionHeader category="general" />
                  <Separator />
                  <div className="flex flex-col gap-3">
                    <div>
                      <h3 className="text-sm font-medium text-foreground">
                        Session layout
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Switch between a visual overview and denser navigation.
                      </p>
                    </div>
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={settings.sessionLayout}
                      onValueChange={(value) => {
                        if (
                          value === "cards" ||
                          value === "tabs" ||
                          value === "sidebar"
                        ) {
                          onSettingsChange(
                            settingPatch(settings, { sessionLayout: value }),
                          )
                        }
                      }}
                      aria-label="Session layout"
                      className="w-full gap-0"
                    >
                      <ToggleGroupItem
                        value="cards"
                        data-gharargah-session-layout-option="cards"
                        className="h-10 flex-1 gap-2"
                      >
                        <LayoutGrid aria-hidden />
                        Cards
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="tabs"
                        data-gharargah-session-layout-option="tabs"
                        className="h-10 flex-1 gap-2"
                      >
                        <PanelsTopLeft aria-hidden />
                        Tabs
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="sidebar"
                        data-gharargah-session-layout-option="sidebar"
                        className="h-10 flex-1 gap-2"
                      >
                        <PanelLeft aria-hidden />
                        Sidebar
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </section>
              </ScrollArea>
            </TabsContent>

            <TabsContent
              value="appearance"
              className="min-h-0 flex-1"
              data-gharargah-settings-panel="appearance"
            >
              <ScrollArea className="size-full">
                <section className="flex flex-col gap-6 p-5 sm:p-7">
                  <SettingsSectionHeader category="appearance" />
                  <Separator />
                  <div className="flex flex-col">
                    <div className="pb-3">
                      <h3 className="text-sm font-medium text-foreground">
                        Theme
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Choose a glass palette.
                      </p>
                    </div>
                    <div className="grid gap-1.5 lg:grid-cols-2">
                      {themes.map((theme) => (
                        <ThemeButton
                          key={theme.id}
                          theme={theme}
                          active={settings.themeId === theme.id}
                          onSelect={() =>
                            onSettingsChange(
                              settingPatch(settings, { themeId: theme.id }),
                            )
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="divide-y divide-border">
                    <SettingsField
                      label="UI font size"
                      htmlFor="gharargah-ui-font-size"
                    >
                      <Input
                        id="gharargah-ui-font-size"
                        type="number"
                        min={10}
                        max={24}
                        step={1}
                        value={settings.fontSize}
                        onChange={(event) =>
                          onSettingsChange(
                            settingPatch(settings, {
                              fontSize: parseNumber(
                                event.target.value,
                                settings.fontSize,
                                10,
                                24,
                              ),
                            }),
                          )
                        }
                        className="h-8 font-mono"
                      />
                    </SettingsField>
                  </div>
                </section>
              </ScrollArea>
            </TabsContent>

            {notificationPrefs ? (
              <TabsContent
                value="notifications"
                className="min-h-0 flex-1"
                data-gharargah-settings-panel="notifications"
              >
                <ScrollArea className="size-full">
                  <section
                    className="flex flex-col gap-6 p-5 sm:p-7"
                    data-gharargah-notification-prefs=""
                  >
                    <SettingsSectionHeader category="notifications" />
                    <Separator />
                    <div className="divide-y divide-border">
                      {(
                        [
                          [
                            "desktopEnabled",
                            "Desktop notifications",
                            "Show native notifications outside Gharargah.",
                          ],
                          [
                            "soundEnabled",
                            "Notification sounds",
                            "Allow native notifications to play a sound.",
                          ],
                          [
                            "notifyOnCompleted",
                            "Turn completed",
                            "Notify when an agent finishes its current turn.",
                          ],
                          [
                            "notifyOnInputRequired",
                            "Input required",
                            "Notify when a session is waiting for your response.",
                          ],
                          [
                            "notifyOnPermissionRequired",
                            "Permission required",
                            "Notify when a session needs approval to continue.",
                          ],
                          [
                            "notifyOnFailure",
                            "Failures",
                            "Notify when a session fails.",
                          ],
                          [
                            "includeBackgroundOutput",
                            "Background terminal output",
                            "Include output produced by terminals that are not focused.",
                          ],
                        ] as const
                      ).map(([key, label, detail]) => {
                        const id = `gharargah-notification-${key}`
                        const disabled =
                          key === "soundEnabled" &&
                          !notificationPrefs.desktopEnabled
                        return (
                          <SettingsField
                            key={key}
                            label={label}
                            detail={detail}
                            htmlFor={id}
                          >
                            <div className="flex justify-start sm:justify-end">
                              <Checkbox
                                id={id}
                                checked={Boolean(notificationPrefs[key])}
                                disabled={disabled}
                                data-gharargah-notification-pref={key}
                                onCheckedChange={(checked) =>
                                  onNotificationPrefsChange({
                                    [key]: checked === true,
                                  })
                                }
                              />
                            </div>
                          </SettingsField>
                        )
                      })}
                    </div>
                  </section>
                </ScrollArea>
              </TabsContent>
            ) : null}

            {serverConnection && onServerConnect ? (
              <TabsContent
                value="server"
                className="min-h-0 flex-1"
                data-gharargah-settings-panel="server"
              >
                <ScrollArea className="size-full">
                  <section
                    className="flex flex-col gap-6 p-5 sm:p-7"
                    data-gharargah-server-settings=""
                  >
                    <SettingsSectionHeader category="server" />
                    <Separator />
                    <div className="divide-y divide-border">
                      <SettingsField
                        label="Current server"
                        detail={
                          serverConnection.mode === "local"
                            ? "Bundled with this app"
                            : "Remote"
                        }
                      >
                        <div
                          className="truncate rounded-md border border-border bg-muted/30 px-2.5 py-2 font-mono text-3xs text-foreground"
                          data-gharargah-active-server=""
                        >
                          {serverConnection.activeUrl}
                        </div>
                      </SettingsField>
                      <SettingsField
                        label="Remote server URL"
                        detail="Enter the root HTTP or HTTPS address."
                        htmlFor="gharargah-remote-server-url"
                      >
                        <div className="flex gap-2">
                          <Input
                            id="gharargah-remote-server-url"
                            type="url"
                            inputMode="url"
                            spellCheck={false}
                            aria-label="Remote server URL"
                            placeholder="https://gharargah.example"
                            value={remoteServerUrl}
                            onChange={(event) =>
                              setRemoteServerUrl(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                remoteServerUrl.trim()
                              ) {
                                event.preventDefault()
                                void connectServer(remoteServerUrl)
                              }
                            }}
                            className="h-8 min-w-0 flex-1 font-mono text-3xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={serverPending || !remoteServerUrl.trim()}
                            onClick={() => void connectServer(remoteServerUrl)}
                            data-gharargah-connect-remote=""
                          >
                            {serverPending ? "Connecting…" : "Connect"}
                          </Button>
                        </div>
                      </SettingsField>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p
                        className="min-w-0 text-xs text-destructive"
                        role={serverError ? "alert" : undefined}
                        data-gharargah-server-error=""
                      >
                        {serverError}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={
                          serverPending ||
                          (serverConnection.mode === "local" &&
                            !serverConnection.startupError)
                        }
                        onClick={() => void connectServer(null)}
                        data-gharargah-use-bundled-server=""
                        className="shrink-0"
                      >
                        Use bundled server
                      </Button>
                    </div>
                  </section>
                </ScrollArea>
              </TabsContent>
            ) : null}
          </main>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
