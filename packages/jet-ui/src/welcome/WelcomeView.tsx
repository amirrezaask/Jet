import { Button } from "@/components/ui/button.js"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js"

export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-background px-6 text-center">
      <Card className="max-w-md border-border bg-card shadow-none">
        <CardHeader className="items-center text-center">
          <CardTitle className="jet-mono-data text-2xl font-semibold tracking-tight">Jet</CardTitle>
          <CardDescription>Editor-first shell for keyboard work</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {bootstrapping ? (
            <p className="text-sm text-muted-foreground">Opening workspace…</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Open a workspace and stay on the keyboard.
              </p>
              <p className="jet-mono-data text-xs text-muted-foreground">
                Cmd-P files · Cmd-Shift-F search · Cmd-Shift-E explorer
              </p>
              <Button onClick={onOpenFolder} className="w-full">
                Open Folder
              </Button>
              {isWebMode && (
                <details className="text-left text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Browser dev setup</summary>
                  <p className="mt-2">
                    Add{" "}
                    <code className="text-foreground">?workspace=fixtures/sample-workspace</code> to the
                    URL or call{" "}
                    <code className="text-foreground">window.__jetAgent.openWorkspace(...)</code>
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
