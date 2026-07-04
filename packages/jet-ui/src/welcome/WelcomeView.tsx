import { Button } from "@/components/ui/button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js"

export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

const SHORTCUTS = [
  { keys: "⌘P", label: "files" },
  { keys: "⌘⇧F", label: "search" },
  { keys: "⌘⇧E", label: "explorer" },
] as const

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="jet-welcome-backdrop flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
      <Card className="jet-welcome-card max-w-lg border bg-card/90 shadow-none backdrop-blur-sm">
        <CardHeader className="items-center gap-3 text-center">
          <CardTitle className="jet-mono-data text-[length:var(--jet-fs-xl)] font-semibold tracking-tight text-foreground">
            Jet
          </CardTitle>
          <CardDescription className="max-w-sm text-[length:var(--jet-fs-sm)]">
            Keyboard-first editor shell — open a folder and stay in flow
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {bootstrapping ? (
            <p className="text-sm text-muted-foreground">Opening workspace…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {SHORTCUTS.map(s => (
                  <span key={s.keys} className="inline-flex items-center gap-1.5">
                    <span className="jet-kbd-chip">{s.keys}</span>
                    <span className="text-[length:var(--jet-fs-2xs)] text-muted-foreground">{s.label}</span>
                  </span>
                ))}
              </div>
              <Button onClick={onOpenFolder} className="w-full font-medium">
                Open Folder
              </Button>
              {isWebMode && (
                <details className="text-left text-[length:var(--jet-fs-2xs)] text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Browser dev setup</summary>
                  <p className="mt-2 leading-relaxed">
                    Add{" "}
                    <code className="jet-mono-data text-foreground">?workspace=fixtures/sample-workspace</code> to the
                    URL or call{" "}
                    <code className="jet-mono-data text-foreground">window.__jetAgent.openWorkspace(...)</code>
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
