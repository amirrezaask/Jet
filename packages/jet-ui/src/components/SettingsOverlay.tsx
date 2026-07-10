import type { JetTheme } from "@jet/codemirror"
import { RotateCcw, X } from "lucide-react"
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
import { Label } from "@/components/ui/label.js"
import { ScrollArea } from "@/components/ui/scroll-area.js"
import { Separator } from "@/components/ui/separator.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { SettingsField } from "@/components/SettingsField.js"
import { themePreviewSwatches } from "@/theme/bundled.js"

export type JetDensity = "compact" | "comfortable"
export type JetCursorStyle = "block" | "bar" | "underline"
export type JetCursorMotion = "trail" | "smooth" | "off"

export type JetAppearanceSettings = {
  themeId: string
  fontSize: number
  monoFontFamily: string
  terminalLineHeight: number
  editorLineHeight: number
  density: JetDensity
  cursorBlink: boolean
  cursorStyle: JetCursorStyle
  cursorMotion: JetCursorMotion
  reducedMotion: boolean
}

export type SettingsOverlayProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  themes: JetTheme[]
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
  theme: JetTheme
  active: boolean
  onSelect: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      data-jet-theme-option={theme.id}
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
        {themePreviewSwatches(theme).slice(0, 10).map((color, index) => (
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
  const grouped = themes.reduce<Record<string, JetTheme[]>>((acc, theme) => {
    const key = theme.family ?? "Jet"
    ;(acc[key] ??= []).push(theme)
    return acc
  }, {})

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-jet-settings-overlay=""
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 sm:max-w-none"
        style={{
          width: "min(68rem, calc(100vw - 3rem))",
          maxWidth: "min(68rem, calc(100vw - 3rem))",
          maxHeight: "min(46rem, calc(100vh - 3rem))",
        }}
      >
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-base">Settings</DialogTitle>
              <DialogDescription className="mt-1">
                Appearance, terminal, and editor preferences.
              </DialogDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="gap-2"
              >
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

        <div className="grid min-h-0 overflow-hidden lg:grid-cols-[minmax(17rem,21rem)_1fr]">
          <ScrollArea className="min-h-0 border-b border-border bg-muted/35 lg:border-r lg:border-b-0">
            <div className="max-h-[18rem] p-3 lg:max-h-[calc(min(46rem,100vh-3rem)-4.5rem)]">
              <div className="mb-2 px-1 text-3xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Themes
              </div>
              <div className="flex flex-col gap-3">
                {Object.entries(grouped).map(([family, familyThemes]) => (
                  <section key={family} className="flex flex-col gap-1.5">
                    <div className="px-1 font-mono text-3xs text-muted-foreground">{family}</div>
                    {familyThemes.map(theme => (
                      <ThemeButton
                        key={theme.id}
                        theme={theme}
                        active={settings.themeId === theme.id}
                        onSelect={() => onSettingsChange(settingPatch(settings, { themeId: theme.id }))}
                      />
                    ))}
                  </section>
                ))}
              </div>
            </div>
          </ScrollArea>

          <ScrollArea className="min-h-0">
            <div className="max-h-[calc(min(46rem,100vh-3rem)-4.5rem)] p-5">
              <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Appearance</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Global chrome scale and density.
                  </p>
                </div>
                <SettingsField label="UI font size" detail="Also drives terminal cell size.">
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
                <SettingsField label="Density">
                  <ToggleGroup
                    type="single"
                    value={settings.density}
                    onValueChange={value => {
                      if (value === "compact" || value === "comfortable") {
                        onSettingsChange(settingPatch(settings, { density: value }))
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <ToggleGroupItem value="compact" className="flex-1">Compact</ToggleGroupItem>
                    <ToggleGroupItem value="comfortable" className="flex-1">Comfortable</ToggleGroupItem>
                  </ToggleGroup>
                </SettingsField>
                <SettingsField label="Reduced motion">
                  <Label className="justify-end font-normal">
                    <Checkbox
                      checked={settings.reducedMotion}
                      onCheckedChange={checked =>
                        onSettingsChange(settingPatch(settings, { reducedMotion: checked === true }))
                      }
                    />
                    Prefer less motion
                  </Label>
                </SettingsField>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Terminal</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    xterm typography and cursor behavior.
                  </p>
                </div>
                <SettingsField label="Mono font" detail="CSS font-family stack.">
                  <Input
                    value={settings.monoFontFamily}
                    onChange={event =>
                      onSettingsChange(settingPatch(settings, { monoFontFamily: event.target.value }))
                    }
                    className="h-8 font-mono"
                  />
                </SettingsField>
                <SettingsField label="Terminal line height">
                  <Input
                    type="number"
                    min={1}
                    max={2}
                    step={0.05}
                    value={settings.terminalLineHeight}
                    onChange={event =>
                      onSettingsChange(
                        settingPatch(settings, {
                          terminalLineHeight: parseNumber(
                            event.target.value,
                            settings.terminalLineHeight,
                            1,
                            2,
                          ),
                        }),
                      )
                    }
                    className="h-8 font-mono"
                  />
                </SettingsField>
                <SettingsField label="Cursor blink">
                  <Label className="justify-end font-normal">
                    <Checkbox
                      checked={settings.cursorBlink}
                      onCheckedChange={checked =>
                        onSettingsChange(settingPatch(settings, { cursorBlink: checked === true }))
                      }
                    />
                    Blink in terminal
                  </Label>
                </SettingsField>
                <SettingsField label="Editor and terminal cursor shape">
                  <ToggleGroup
                    type="single"
                    value={settings.cursorStyle}
                    onValueChange={value => {
                      if (value === "block" || value === "bar" || value === "underline") {
                        onSettingsChange(settingPatch(settings, { cursorStyle: value }))
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <ToggleGroupItem value="block" data-jet-setting="terminal-cursor-style-block" className="flex-1">Block</ToggleGroupItem>
                    <ToggleGroupItem value="bar" data-jet-setting="terminal-cursor-style-bar" className="flex-1">Bar</ToggleGroupItem>
                    <ToggleGroupItem value="underline" data-jet-setting="terminal-cursor-style-underline" className="flex-1">Line</ToggleGroupItem>
                  </ToggleGroup>
                </SettingsField>
                <SettingsField label="Editor and terminal cursor motion" detail="Trail uses a bounded five-frame ghost tail.">
                  <ToggleGroup
                    type="single"
                    value={settings.cursorMotion}
                    onValueChange={value => {
                      if (value === "trail" || value === "smooth" || value === "off") {
                        onSettingsChange(settingPatch(settings, { cursorMotion: value }))
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    <ToggleGroupItem value="trail" data-jet-setting="terminal-cursor-motion-trail" className="flex-1">Trail</ToggleGroupItem>
                    <ToggleGroupItem value="smooth" data-jet-setting="terminal-cursor-motion-smooth" className="flex-1">Smooth</ToggleGroupItem>
                    <ToggleGroupItem value="off" data-jet-setting="terminal-cursor-motion-off" className="flex-1">Off</ToggleGroupItem>
                  </ToggleGroup>
                </SettingsField>
              </section>

              <Separator />

              <section className="flex flex-col gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Editor</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    CodeMirror uses the same mono family as terminal.
                  </p>
                </div>
                <SettingsField label="Editor line height">
                  <Input
                    type="number"
                    min={1.1}
                    max={2}
                    step={0.05}
                    value={settings.editorLineHeight}
                    onChange={event =>
                      onSettingsChange(
                        settingPatch(settings, {
                          editorLineHeight: parseNumber(
                            event.target.value,
                            settings.editorLineHeight,
                            1.1,
                            2,
                          ),
                        }),
                      )
                    }
                    className="h-8 font-mono"
                  />
                </SettingsField>
              </section>
              </div>
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
