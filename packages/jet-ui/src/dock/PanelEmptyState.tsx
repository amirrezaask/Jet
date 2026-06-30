export function PanelEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-[var(--jet-text)]">Empty panel</p>
      <p className="max-w-sm text-xs text-[var(--jet-text-muted)]">
        <span className="jet-mono-data">⌘P</span> Quick open
        <span className="mx-2 opacity-40">·</span>
        <span className="jet-mono-data">⌘⇧B</span> Buffer list
        <span className="mx-2 opacity-40">·</span>
        <span className="jet-mono-data">⌘⇧E</span> Explorer
      </p>
    </div>
  )
}
