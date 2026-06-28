export function SearchTab({ onFindInEditor }: { onFindInEditor: () => void }) {
  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm text-[var(--jet-text-muted)]">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--jet-text)]">Search</h2>
      <p>Project-wide search is coming soon.</p>
      <button
        type="button"
        className="self-start rounded border border-[var(--jet-border)] px-3 py-1.5 text-xs hover:bg-[var(--jet-hover)]"
        onClick={onFindInEditor}
      >
        Find in active editor (Mod-f)
      </button>
    </div>
  )
}
