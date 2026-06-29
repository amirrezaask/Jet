export function PanelEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-[var(--jet-text)]">No tabs open</p>
      <p className="max-w-sm text-xs text-[var(--jet-text-muted)]">
        <span className="jet-mono-data">⌘P</span> Go to file
        <span className="mx-2 opacity-40">·</span>
        <span className="jet-mono-data">⌘⇧E</span> Explorer
        <span className="mx-2 opacity-40">·</span>
        <span className="jet-mono-data">⌘⇧G</span> Git
      </p>
    </div>
  )
}
