export function PanelEmptyState() {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center"
      aria-label="No file open"
    >
      <p className="jet-empty-hint">No file open</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="jet-kbd-chip">⌘P</span>
        <span className="text-[length:var(--jet-fs-2xs)] text-muted-foreground">quick open</span>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <span className="jet-kbd-chip">⌘N</span>
        <span className="text-[length:var(--jet-fs-2xs)] text-muted-foreground">new file</span>
      </div>
    </div>
  )
}
