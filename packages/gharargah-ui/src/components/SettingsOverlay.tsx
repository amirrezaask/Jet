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

export const DEFAULT_UI_FONT_FAMILY =
  '"Geist Variable", "Geist", ui-sans-serif, system-ui, sans-serif'
export const DEFAULT_MONO_FONT_FAMILY =
  '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace'

export type JetAppearanceSettings = {
  themeId: string
  fontSize: number
  /** CSS font-family for UI chrome (`--font-sans`). */
  fontFamily: string
  /** CSS font-family for terminal / editor mono (`--font-mono`). */
  monoFontFamily: string
}

export type SettingsOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: GharargahTheme[]
  settings: JetAppearanceSettings
  onSettingsChange: (settings: JetAppearanceSettings) => void
  onReset: () => void
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
              <DialogDescription className="mt-1">Theme, font size, and font family.</DialogDescription>
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
