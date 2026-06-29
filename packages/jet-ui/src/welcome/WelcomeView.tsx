export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

function PanelDiagram() {
  return (
    <pre
      className="jet-mono-data select-none text-left text-[10px] leading-relaxed text-[var(--jet-text-muted)]"
      aria-hidden
    >
      {`┌─ header ─────────────────────┐
│ JET │ workspace              │
├──────────────────────────────┤
│                              │
│   (empty — open a file)      │
│                              │
├──────────────────────────────┤
│ path · branch · Ln/Col · LSP │
└──────────────────────────────┘`}
    </pre>
  )
}

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-[var(--jet-bg)] px-6 text-center">
      <div className="flex flex-col items-center gap-2">
        <h1 className="jet-wordmark jet-mono-data text-xl text-[var(--jet-accent)]">JET</h1>
        <div className="h-px w-12 bg-[var(--jet-accent)]" />
      </div>
      {bootstrapping ? (
        <p className="text-sm text-[var(--jet-text-muted)]">Opening workspace…</p>
      ) : (
        <>
          <PanelDiagram />
          <p className="max-w-md text-sm text-[var(--jet-text-muted)]">Open a folder to edit.</p>
          <button
            type="button"
            className="rounded border border-[var(--jet-accent)] bg-[var(--jet-panel)] px-4 py-2 text-sm text-[var(--jet-text)] hover:bg-[var(--jet-hover)]"
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
