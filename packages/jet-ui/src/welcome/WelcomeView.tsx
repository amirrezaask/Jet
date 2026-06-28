export type WelcomeViewProps = {
  isWebMode: boolean
  bootstrapping?: boolean
  onOpenFolder: () => void
}

export function WelcomeView({ isWebMode, bootstrapping, onOpenFolder }: WelcomeViewProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-[var(--jet-bg)] px-6 text-center">
      <h1 className="text-lg font-semibold text-[var(--jet-accent)]">Jet Editor</h1>
      {bootstrapping ? (
        <p className="text-sm text-[var(--jet-text-muted)]">Opening workspace…</p>
      ) : (
        <>
          <p className="max-w-md text-sm text-[var(--jet-text-muted)]">
            Open a folder to start editing. Jet is inspired by 4coder, Nameless Editor, and RAD
            Debugger aesthetics.
          </p>
          <button
            type="button"
            className="rounded border border-[var(--jet-border)] bg-[var(--jet-panel)] px-4 py-2 text-sm hover:bg-[var(--jet-hover)]"
            onClick={onOpenFolder}
          >
            Open Folder
          </button>
          {isWebMode && (
            <p className="max-w-md text-xs text-[var(--jet-text-muted)]">
              Browser dev: add{" "}
              <code className="text-[var(--jet-text)]">?workspace=fixtures/sample-workspace</code>{" "}
              to the URL or call{" "}
              <code className="text-[var(--jet-text)]">window.__jetAgent.openWorkspace(...)</code>
            </p>
          )}
        </>
      )}
    </div>
  )
}
