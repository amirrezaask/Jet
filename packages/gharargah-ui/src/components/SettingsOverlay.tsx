import type { GharargahTheme } from "@gharargah/codemirror"
import { RotateCcw, X } from "lucide-react"
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
import { SettingsField } from "@/components/SettingsField.js"
import { themePreviewSwatches } from "@/theme/bundled.js"

export type JetAppearanceSettings = {
  themeId: string
  fontSize: number
}

export type SettingsOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: GharargahTheme[]
  settings: JetAppearanceSettings
  onSettingsChange: (settings: JetAppearanceSettings) => void
  onReset: () => void
}

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

export function SettingsOverlay({
  open,
  onOpenChange,
  themes,
  settings,
  onSettingsChange,
  onReset,
}: SettingsOverlayProps) {
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
              <DialogDescription className="mt-1">Theme and font size.</DialogDescription>
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
          <div className="max-h-[calc(min(36rem,100vh-3rem)-4.5rem)] space-y-6 p-4">
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
                  UI scale; also drives terminal cell size.
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
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
