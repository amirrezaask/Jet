import { Button } from "@/components/ui/button.js"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.js"
import { KeyBindingKbd } from "@/components/KeyBindingKbd.js"
import { formatKeyBinding } from "@/lib/format-key.js"

export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

const SHORTCUTS = [
  { keys: formatKeyBinding("Mod-p"), label: "files" },
  { keys: formatKeyBinding("Mod-Shift-f"), label: "search" },
  { keys: formatKeyBinding("Mod-Shift-e"), label: "explorer" },
] as const

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <Card className="max-w-lg border bg-card shadow-sm">
        <CardHeader className="items-center gap-3 text-center">
          <CardTitle className="text-balance text-2xl font-semibold tracking-tight">
            Jet
          </CardTitle>
          <CardDescription className="max-w-sm text-balance">
            Keyboard-first editor shell — open a folder and stay in flow
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {bootstrapping ? (
            <p className="text-sm text-muted-foreground">Opening workspace…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {SHORTCUTS.map(s => (
                  <span key={s.label} className="inline-flex items-center gap-1.5">
                    <KeyBindingKbd binding={s.keys} />
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                  </span>
                ))}
              </div>
              <Button onClick={onOpenFolder} className="w-full font-medium">
                Open Folder
              </Button>
              {isWebMode && (
                <details className="text-left text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Browser dev setup</summary>
                  <p className="mt-2 leading-relaxed">
                    Add{" "}
                    <code className="font-mono tabular-nums text-foreground">?workspace=fixtures/sample-workspace</code> to the
                    URL or call{" "}
                    <code className="font-mono tabular-nums text-foreground">window.__jetAgent.openWorkspace(…)</code>
                  </p>
                </details>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
