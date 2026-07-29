import type { GharargahTheme } from "@gharargah/shared"
import { LayoutGrid, PanelLeft, PanelsTopLeft, RotateCcw, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button.js"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { SettingsField } from "@/components/SettingsField.js"
import { themePreviewSwatches } from "@/theme/bundled.js"

export const DEFAULT_UI_FONT_FAMILY =
  '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif'
export const DEFAULT_MONO_FONT_FAMILY =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace'

export type SessionLayout = "cards" | "tabs" | "sidebar"

export type JetAppearanceSettings = {
  themeId: string
  fontSize: number
  /** CSS font-family for UI chrome (`--font-sans`). */
  fontFamily: string
  /** CSS font-family for terminal / editor mono (`--font-mono`). */
  monoFontFamily: string
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
  onServerConnect?: (serverUrl: string | null) => Promise<DesktopServerConnection>
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
  getServerConnection: () => Promise<DesktopServerConnection>
  connectToServer: (serverUrl: string | null) => Promise<DesktopServerConnection>
}

declare global {
  interface Window {
    gharargahDesktop?: GharargahDesktopBridge
  }
}

const UI_FONT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: "geist", label: "Geist", value: DEFAULT_UI_FONT_FAMILY },
  {
    id: "system",
    label: "System",
    value: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  {
    id: "ibm-plex",
    label: "IBM Plex Sans",
    value: '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  },
]

const MONO_FONT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: "geist-mono", label: "Geist Mono", value: DEFAULT_MONO_FONT_FAMILY },
  {
    id: "system-mono",
    label: "System Mono",
    value: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace',
  },
  {
    id: "ibm-plex-mono",
    label: "IBM Plex Mono",
    value: '"IBM Plex Mono", ui-monospace, monospace',
  },
]

function parseNumber(value: string, fallback: number, min: number, max: number): number {
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

function normalizeFontFamily(value: string, fallback: string): string {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
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
      className="h-auto min-h-12 w-full justify-start gap-3 border px-3 py-2 text-left"
    >
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-current">{theme.name}</span>
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

function FontPresetRow({
  presets,
  value,
  onSelect,
  dataAttr,
}: {
  presets: { id: string; label: string; value: string }[]
  value: string
  onSelect: (next: string) => void
  dataAttr: string
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {presets.map(preset => {
        const active = value === preset.value
        return (
          <Button
            key={preset.id}
            type="button"
            size="sm"
            variant={active ? "secondary" : "outline"}
            aria-pressed={active}
            data-gharargah-font-preset={`${dataAttr}:${preset.id}`}
            onClick={() => onSelect(preset.value)}
            className="h-7 px-2 text-3xs"
            style={{ fontFamily: preset.value }}
          >
            {preset.label}
          </Button>
        )
      })}
    </div>
  )
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

  useEffect(() => {
    if (!open || !serverConnection) return
    setRemoteServerUrl(serverConnection.mode === "remote" ? serverConnection.activeUrl : "")
    setServerError(serverConnection.startupError ?? null)
  }, [open, serverConnection])

  useEffect(() => {
    if (!open || notificationPrefsProp) return
    const api = window.gharargah?.notifications
    if (!api) return
    void api.getPreferences().then(setLocalPrefs).catch(() => {})
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-gharargah-settings-overlay=""
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{
          width: "min(32rem, calc(100vw - 3rem))",
          maxWidth: "min(32rem, calc(100vw - 3rem))",
          maxHeight: "min(36rem, calc(100vh - 3rem))",
        }}
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">Settings</DialogTitle>
              <DialogDescription className="mt-1">
                Server, session layout, theme, typography, and notifications.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={onReset} className="gap-2">
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Close settings">
                  <X className="size-3.5" />
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          <div className="flex max-h-[calc(min(36rem,100vh-3rem)-4.5rem)] flex-col gap-6 p-4">
            {serverConnection && onServerConnect ? (
              <section className="flex flex-col gap-3" data-gharargah-server-settings="">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Server</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Electron includes a local server. Connecting elsewhere reloads the app from
                    that Gharargah server.
                  </p>
                </div>
                <SettingsField
                  label="Current server"
                  detail={serverConnection.mode === "local" ? "Bundled with this app" : "Remote"}
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
                  detail="Root http(s) origin, for example https://gharargah.example."
                >
                  <div className="flex gap-2">
                    <Input
                      type="url"
                      inputMode="url"
                      spellCheck={false}
                      aria-label="Remote server URL"
                      placeholder="https://gharargah.example"
                      value={remoteServerUrl}
                      onChange={event => setRemoteServerUrl(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter" && remoteServerUrl.trim()) {
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
                      (serverConnection.mode === "local" && !serverConnection.startupError)
                    }
                    onClick={() => void connectServer(null)}
                    data-gharargah-use-bundled-server=""
                    className="shrink-0"
                  >
                    Use bundled server
                  </Button>
                </div>
              </section>
            ) : null}

            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Session layout</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cards, browser-style tabs, or a project/session sidebar.
                </p>
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                value={settings.sessionLayout}
                onValueChange={value => {
                  if (value === "cards" || value === "tabs" || value === "sidebar") {
                    onSettingsChange(settingPatch(settings, { sessionLayout: value }))
                  }
                }}
                aria-label="Session layout"
                className="w-full gap-0"
              >
                <ToggleGroupItem
                  value="cards"
                  data-gharargah-session-layout-option="cards"
                  className="h-9 flex-1 gap-2"
                >
                  <LayoutGrid aria-hidden />
                  Cards
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="tabs"
                  data-gharargah-session-layout-option="tabs"
                  className="h-9 flex-1 gap-2"
                >
                  <PanelsTopLeft aria-hidden />
                  Tabs
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="sidebar"
                  data-gharargah-session-layout-option="sidebar"
                  className="h-9 flex-1 gap-2"
                >
                  <PanelLeft aria-hidden />
                  Sidebar
                </ToggleGroupItem>
              </ToggleGroup>
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Theme</h3>
                <p className="mt-1 text-xs text-muted-foreground">Glass variants only.</p>
              </div>
              <div className="flex flex-col gap-1.5">
                {themes.map(theme => (
                  <ThemeButton
                    key={theme.id}
                    theme={theme}
                    active={settings.themeId === theme.id}
                    onSelect={() => onSettingsChange(settingPatch(settings, { themeId: theme.id }))}
                  />
                ))}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Font</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Size scales UI and terminal cells; family applies via CSS variables.
                </p>
              </div>
              <SettingsField label="UI font size">
                <Input
                  type="number"
                  min={10}
                  max={24}
                  step={1}
                  value={settings.fontSize}
                  onChange={event =>
                    onSettingsChange(
                      settingPatch(settings, {
                        fontSize: parseNumber(event.target.value, settings.fontSize, 10, 24),
                      }),
                    )
                  }
                  className="h-8 font-mono"
                />
              </SettingsField>
              <SettingsField label="UI font family" detail="Body and chrome (`--font-sans`).">
                <div className="flex flex-col gap-2">
                  <FontPresetRow
                    presets={UI_FONT_PRESETS}
                    value={settings.fontFamily}
                    dataAttr="ui"
                    onSelect={next =>
                      onSettingsChange(settingPatch(settings, { fontFamily: next }))
                    }
                  />
                  <Input
                    type="text"
                    spellCheck={false}
                    value={settings.fontFamily}
                    data-gharargah-font-family-input="ui"
                    onChange={event =>
                      onSettingsChange(
                        settingPatch(settings, { fontFamily: event.target.value }),
                      )
                    }
                    onBlur={event =>
                      onSettingsChange(
                        settingPatch(settings, {
                          fontFamily: normalizeFontFamily(
                            event.target.value,
                            DEFAULT_UI_FONT_FAMILY,
                          ),
                        }),
                      )
                    }
                    className="h-8 font-mono text-3xs"
                    style={{ fontFamily: settings.fontFamily }}
                  />
                </div>
              </SettingsField>
              <SettingsField label="Mono font family" detail="Terminal and editor (`--font-mono`).">
                <div className="flex flex-col gap-2">
                  <FontPresetRow
                    presets={MONO_FONT_PRESETS}
                    value={settings.monoFontFamily}
                    dataAttr="mono"
                    onSelect={next =>
                      onSettingsChange(settingPatch(settings, { monoFontFamily: next }))
                    }
                  />
                  <Input
                    type="text"
                    spellCheck={false}
                    value={settings.monoFontFamily}
                    data-gharargah-font-family-input="mono"
                    onChange={event =>
                      onSettingsChange(
                        settingPatch(settings, { monoFontFamily: event.target.value }),
                      )
                    }
                    onBlur={event =>
                      onSettingsChange(
                        settingPatch(settings, {
                          monoFontFamily: normalizeFontFamily(
                            event.target.value,
                            DEFAULT_MONO_FONT_FAMILY,
                          ),
                        }),
                      )
                    }
                    className="h-8 font-mono text-3xs"
                    style={{ fontFamily: settings.monoFontFamily }}
                  />
                </div>
              </SettingsField>
            </section>

            {notificationPrefs && onNotificationPrefsChange ? (
              <section
                className="flex flex-col gap-3"
                data-gharargah-notification-prefs
              >
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Controls in-app and desktop delivery. Session attention tracking is separate.
                  </p>
                </div>
                {(
                  [
                    ["desktopEnabled", "Desktop notifications"],
                    ["notifyOnCompleted", "Turn completed"],
                    ["notifyOnInputRequired", "Input required"],
                    ["notifyOnPermissionRequired", "Permission required"],
                    ["notifyOnFailure", "Failures"],
                    ["includeBackgroundOutput", "Background PTY output"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 text-xs text-foreground"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(notificationPrefs[key])}
                      data-gharargah-notification-pref={key}
                      onChange={e =>
                        onNotificationPrefsChange({ [key]: e.target.checked })
                      }
                    />
                  </label>
                ))}
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
