# Gharargah — Senior PM UX Review (2026-07)

Scope: unify product feel across explorers, overlays, keymap, theme. Not a redesign. Every finding is a concrete PR-sized fix.

---

## A. Explorer / list panel consistency

| Panel | Component | Row primitive | Row height | Font | Icon | Hover | Empty state | `registerListPanel` |
|---|---|---|---|---|---|---|---|---|
| File explorer | `ExplorerTab.tsx` | `TreeView` → `SidebarMenuSubButton` | `--jet-row-height` | inherit (13px) | `size-3.5` | `jet-interactive-row` | inline `<div>` "Loading…" | `EXPLORER_LIST_ID` |
| Terminal explorer | `TerminalExplorerTab.tsx` | `TreeView` → `SidebarMenuSubButton` | `--jet-row-height` | inherit (13px) | `size-3.5` | `jet-interactive-row` | inline `<p>` "Open a workspace…" | `TERMINAL_EXPLORER_LIST_ID` |
| Agent explorer | `AgentExplorerTab.tsx` | **raw `<button>`** | `py-2` (~ad-hoc) | `text-sm` + `text-[11px]` two-line | mixed `size-3.5`/`size-4` | inline `hover:bg-sidebar-accent` | inline `<div>` | `"jet:agent-explorer"` (string literal) |
| Search / Diagnostics / References / Definitions / Task-errors | `LocationList.tsx` (shared base) | `ListRow` → `SidebarMenuSubButton` | `--jet-location-row-height` | `text-sm` label / `text-xs` path | none | `jet-interactive-row` (via ListRow) | `<Empty>` shadcn | passthrough |
| Output | `OutputPanel.tsx` | log `<pre>` — n/a | n/a | `text-xs font-mono` | n/a | n/a | inline text | `"output"` (string literal) |

**Rules established (do not merge):**
- Tree / dense navigation → `--jet-row-height` (22px @ 13px base).
- Flat click-to-jump list → `--jet-location-row-height` (32.5px @ 13px base), two-line `label` + `path:line:col`.
- Log surfaces are not lists (Output). Excluded from row rules.

**Drift:**
1. `AgentExplorerTab` bypasses `<ListRow>` and `<TreeView>`. Reinvents chevron + expansion, uses `rounded-xl border` card per group, `size-4` chevron vs `size-3` in other trees. **Fix:** port to `TreeView`, `renderRow` draws status icon + title + `formatRelativeTime` in single line (put stats in `title=` tooltip) or accept `--jet-location-row-height` (two-line). **Effort:** medium.
2. `AgentExplorerTab` and `OutputPanel` register list panels with string literals (`"jet:agent-explorer"`, `"output"`). **Fix:** export named constants next to component (like `EXPLORER_LIST_ID`). **Effort:** trivial.
3. Empty-state grammar: `LocationList` uses shadcn `<Empty>`; explorers use ad-hoc `<div>`/`<p>`. **Fix:** all panels use `<Empty>` for zero-state. **Effort:** trivial.

---

## B. Overlay grammar

All overlays use shadcn `<Dialog>`. Motion + `jet-overlay-enter` auto-applied via `jetOverlayContentClass` in `packages/jet-ui/src/components/ui/dialog.tsx:64`. Uniform. Backdrop, Escape/close, portaling: consistent.

**Drift — width:**

| Overlay | `DialogContent` width |
|---|---|
| `CommandPalette` | `max-w-[34rem]` |
| `QuickOpenOverlay` | `max-w-[36rem]` |
| `BufferListOverlay` | `max-w-[32rem]` |
| `ProjectSwitcherOverlay` | `max-w-[42rem]` |
| `WorkspaceFolderPickerOverlay` | `max-w-[42rem]` |
| `OpenFileOverlay` (native) | `sm:max-w-md` (28rem) |
| `OpenFileOverlay` (tree)   | `sm:max-w-lg` (32rem) |
| `CdOverlay` | `sm:max-w-lg` (32rem) |
| `OutlineOverlay` | `max-w-md` (28rem) |
| `GotoLineModal` | `sm:max-w-sm` (24rem) |

**Fix:** introduce three width tokens on `DialogContent`:
- `data-gharargah-overlay="prompt"` → 24rem (goto-line class: one-shot input).
- `data-gharargah-overlay="picker"` → 32rem (buffer, quick-open, palette, outline, workspace picker).
- `data-gharargah-overlay="wide"` → 42rem (project switcher, future search).

Codify in `globals.css` as `--jet-overlay-w-prompt/picker/wide`. Delete per-file widths. **Effort:** small (1 file rewrite + 10 line changes across overlays).

**Vestigial:** `PaletteOverlay.tsx` is a 1-line re-export of `CommandPalette`. Either delete or make it the wrapping composition point. Currently useless indirection.

---

## C. Keymap audit

`scripts/validate-jet-keybindings.mjs` output:
```
default-keybindings.ts: 16 active bind(), 419 TODO comments, 14 implemented mappings checked
```
No conflicts reported. Generation source: `packages/jet-workspace/data/vscode-mac-keybindings.json`.

**Rogue `addEventListener("keydown", …)` outside `KeymapService`:**

| Location | Purpose | Verdict |
|---|---|---|
| `packages/jet-app/src/App.tsx:2343` | KeymapService dispatch entry | Legit — the one true entry |
| `packages/jet-ui/src/components/ui/sidebar.tsx:109` | shadcn Cmd-b sidebar toggle | **Vestigial.** Gharargah uses `PanelDock`, not shadcn `Sidebar`. This handler still binds `Cmd-b` globally on any mounted `SidebarProvider`. Risk of collision with future `Cmd-b` command. **Fix:** patch shadcn primitive to gate on `enableKeyboardShortcut` prop (default false) or delete the effect. **Effort:** small. |
| `packages/jet-ui/src/motion/useJetCaretOverlay.tsx:398` | Per-input caret motion | Legit — attached to specific `<input>`, released on unmount. |
| `packages/jet-ui/src/agents/composer/ModelPickerContent.tsx:500` | Model-picker keyboard capture | Verify releases on blur / dialog close. If not, leak. |

**Agent keybindings file:**
`packages/jet-ui/src/agents/keybindings.ts` is a **stub** — every export returns `null`. Not the AGENTS.md-referenced hand-maintained keymap. Either delete or wire up. Currently dead code.

**Cross-platform:**
`Mod-Shift-` `` ` `` (terminal-explorer) on Linux/Windows = `Ctrl-Shift-` `` ` ``. Terminal panel = `Ctrl-` `` ` ``. No collision (Shift modifier differs). Confirmed safe.

---

## D. Theming

**Tokens:** `--jet-row-height`, `--jet-location-row-height`, `--jet-titlebar-height` defined once in `:root` (`globals.css:90-92`), not duplicated in `.dark`. Scheme-invariant — correct. Comment added codifying contract.

**Bundled themes:** AGENTS.md claim of 6 bundled (`Catppuccin`, `One Dark`, `Gruvbox`, `Nord`, `4coder`, `Vercel`) is **wrong** — `packages/jet-ui/src/theme/bundled.ts` only re-exports `vercelDark`/`vercelLight` from `theme/vercel.ts:87`. **Action:** either land the missing themes or update AGENTS.md to match reality. Recommend the latter — Vercel is a fine default; multi-theme is not a shipped feature.

**Open backlog (not this pass):** CodeMirror indent markers baked at view creation — theme swap requires view rebuild. Wrap in Compartment.

---

## E. Product feel — top 5

1. **AgentExplorerTab lives in its own visual world.**
   *Why it hurts unity:* card-per-group with `rounded-xl border`, two-line row, non-`ListRow`, raw `<button>`. Adjacent to file/terminal explorers, breaks the "these are the same thing" reading.
   *Fix:* port to `TreeView` with `wrapRow` for context menu (same pattern terminal explorer uses). Reuse `formatRelativeTime` in `title=`.
   *Effort:* medium (1 file, ~150 lines → ~80).

2. **Overlay width chaos.**
   *Why it hurts unity:* seven widths across ten overlays for essentially three shapes (prompt, picker, wide). Users perceive the app as inconsistent even if they can't name why.
   *Fix:* three CSS tokens + `data-gharargah-overlay` attribute, per Section B.
   *Effort:* small.

3. **Vestigial shadcn `Sidebar` `Cmd-b` handler.**
   *Why it hurts unity:* invisible landmine. Any future `Cmd-b` command silently gets ate.
   *Fix:* remove effect or gate behind opt-in prop.
   *Effort:* trivial.

4. **`registerListPanel` uses string literals for `agent-explorer` and `output`.**
   *Why it hurts unity:* rest of codebase uses `EXPLORER_LIST_ID` / `TERMINAL_EXPLORER_LIST_ID` exported constants. String literals are typo-prone and un-refactorable.
   *Fix:* export named constants; import at call site.
   *Effort:* trivial.

5. **Empty states are ad-hoc except in LocationList.**
   *Why it hurts unity:* explorer empty ("Open a folder…") is a bare `<div>`; terminal explorer empty is a bare `<p>`; LocationList uses `<Empty>` shadcn primitive with title + description. Same class of moment, three grammars.
   *Fix:* one shared `<PanelEmpty title, description, action?>` wrapping shadcn `<Empty>`. Adopt in all explorers.
   *Effort:* small.

---

## Not in this pass (call out, defer)

- Missing breadcrumbs UI — command palette covers navigation; low value.
- CodeMirror indent-marker theme swap regression — separate CM concern.
- Missing `<Button variant="ghost">` migration on StatusBar LSP trigger — cosmetic.
- OpenFileOverlay has two DialogContent blocks (native + tree) — intentional dual UI; keep.
