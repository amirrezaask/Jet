export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

function PanelDiagram() {
  return (
    <pre
      className="jet-mono-data select-none text-left text-[11px] leading-relaxed text-[var(--jet-text-muted)]"
      aria-hidden
    >
      {`┌─ signal rail ──────────────────┐
│ JET   files   search   terminal  │
├───────────────────────────────────┤
│ source                           │
│   editor                         │
│                                  │
├───────────────────────────────────┤
│ path · branch · line/col · lsp   │
└───────────────────────────────────┘`}
    </pre>
  )
}

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-[var(--jet-bg)] px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-px w-16 bg-[var(--jet-border)]" />
        <h1 className="jet-wordmark jet-mono-data text-2xl text-[var(--jet-accent)]">JET</h1>
        <p className="max-w-md text-[12px] uppercase tracking-[0.18em] text-[var(--jet-text-muted)]">
          editor-first shell for keyboard work
        </p>
      </div>
      {bootstrapping ? (
        <p className="text-sm text-[var(--jet-text-muted)]">Opening workspace…</p>
      ) : (
        <>
          <PanelDiagram />
          <div className="max-w-md space-y-2 text-sm text-[var(--jet-text-muted)]">
            <p>Open a workspace and stay on the keyboard.</p>
            <p className="jet-mono-data text-[12px]">Cmd-P files · Cmd-Shift-F search · Cmd-Shift-E explorer</p>
          </div>
          <button
            type="button"
            className="rounded-sm border border-[var(--jet-accent)] bg-[var(--jet-panel)] px-4 py-2 text-sm text-[var(--jet-text)] hover:bg-[var(--jet-hover)] focus-visible:outline-none"
            onClick={onOpenFolder}
          >
            Open Folder
          </button>
          {isWebMode && (
            <details className="max-w-md text-left text-xs text-[var(--jet-text-muted)]">
              <summary className="cursor-pointer hover:text-[var(--jet-text)]">Browser dev setup</summary>
              <p className="mt-2">
                Add{" "}
                <code className="text-[var(--jet-text)]">?workspace=fixtures/sample-workspace</code> to
                the URL or call{" "}
                <code className="text-[var(--jet-text)]">window.__jetAgent.openWorkspace(...)</code>
              </p>
            </details>
          )}
        </>
      )}
    </div>
  )
}
