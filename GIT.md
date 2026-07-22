



## Recommended direction

Build Git as a **wide, resizable right-side workspace**, not a narrow settings drawer. It should let the user inspect, stage, commit, and push changes without leaving the active project or terminal.

Use shadcn’s `Sheet` with `side="right"` as the outer primitive. `Sheet` is intended for complementary screen content and officially supports right-side placement. Inside it, use shadcn `ResizablePanelGroup` for the file navigator and diff viewer. citeturn210009search1turn210009search0

```txt
┌──────────────────────────── Jet workspace ──────────────┬──────────────────────── Git ──┐
│                                                         │ main   ↑2 ↓0          Fetch  × │
│                                                         ├───────────────────────────────┤
│                                                         │ Changes  Staged  History       │
│                                                         ├──────────────┬────────────────┤
│                                                         │ 7 changes    │ src/git/git.ts  │
│                                                         │              │ M  +34  -12     │
│                                                         │ □ git.ts     ├────────────────┤
│                                                         │ ■ drawer.tsx │                │
│                                                         │ □ types.ts   │ virtualized    │
│                                                         │ □ README.md  │ unified diff   │
│                                                         │              │                │
│                                                         │              │                │
│                                                         ├──────────────┴────────────────┤
│                                                         │ Commit message…               │
│                                                         │ Optional description…         │
│                                                         │                    Commit 3 ▾  │
└─────────────────────────────────────────────────────────┴───────────────────────────────┘
```

## Component structure

```tsx
<GitDrawer>
  <GitDrawerHeader />

  <GitNavigation>
    <Tabs>
      <TabsTrigger value="changes" />
      <TabsTrigger value="staged" />
      <TabsTrigger value="history" />
    </Tabs>

    <DiffViewToggle />
    <GitRefreshButton />
  </GitNavigation>

  <ResizablePanelGroup orientation="horizontal">
    <ResizablePanel defaultSize="28%">
      <ChangedFilesPanel />
    </ResizablePanel>

    <ResizableHandle />

    <ResizablePanel defaultSize="72%">
      <FileDiffPanel />
    </ResizablePanel>
  </ResizablePanelGroup>

  <CommitComposer />
</GitDrawer>
```

Recommended drawer sizing:

```tsx
<SheetContent
  side="right"
  className="
    w-[min(92vw,1040px)]
    max-w-none
    gap-0
    overflow-hidden
    border-l border-cyan-200/10
    bg-[#07101b]/95
    p-0
    shadow-[-24px_0_80px_rgba(0,0,0,0.38)]
    backdrop-blur-2xl
  "
/>
```

Persist the user-selected drawer width per repository or globally.

## 1. Header

Keep it around `44px` high.

Left:

- Repository name.
- Current branch as a compact dropdown.
- Ahead/behind indicators such as `↑2 ↓1`.
- Dirty-state dot.

Right:

- Fetch.
- Pull/push split button.
- Overflow menu.
- Close.

Visual treatment:

```txt
jet
main  ↑2
```

The branch should feel like project metadata, not a large GitHub-style toolbar.

Use cyan/blue only for focus and selection. Use green for clean/staged/success states. Reserve red for deletions, conflicts, discard operations, and failed commands.

## 2. Changed-files panel

Use two collapsible sections:

```txt
STAGED CHANGES                          3
  ■ M  src/git/drawer.tsx          +34 −12
  ■ A  src/git/types.ts             +91

CHANGES                                 4
  □ M  src/app/router.tsx            +8  −3
  □ D  src/legacy/git.ts                 −84
```

Each row should contain:

- Stage checkbox.
- Git status letter: `M`, `A`, `D`, `R`, `U`.
- Truncated path with filename emphasized.
- Addition/deletion counts.
- Context menu.

Interactions:

- Clicking the row opens the diff.
- Clicking the checkbox stages or unstages the complete file.
- Hover reveals `Open file`, `Discard`, and `More`.
- Right-click provides stage, unstage, discard, copy path, and reveal in file tree.
- `Shift` selection supports staging multiple files.

Do not turn this into a generic checkbox list. Give the selected file a subtle left-edge cyan indicator and slightly lighter glass background.

## 3. Diff panel

### File header

```txt
M  src/components/git/git-drawer.tsx                 +34 −12

[Open file] [Unified | Split] [Stage file] [•••]
```

Keep this header sticky while the diff scrolls.

### Diff appearance

Use a restrained sci-fi treatment:

- Base code background: almost black with a very slight blue tint.
- Addition line: `emerald` at roughly 6–9% opacity.
- Deletion line: `red` at roughly 6–9% opacity.
- Addition/deletion gutter: 14–18% opacity.
- Hunk header: translucent cyan/navy.
- Line numbers: low-contrast monospace.
- Current hovered line: thin cyan outline rather than a bright fill.
- Syntax highlighting should remain more prominent than the diff background.

```txt
@@ -41,6 +41,12 @@ export function GitDrawer() {

  41   41  const repo = useCurrentRepository()
- 42       const files = await loadFiles()
+      42  const status = await git.getStatus(repo.path)
+      43  const files = normalizeStatus(status)
```

### Actions

Support these first:

- Stage complete file.
- Stage complete hunk.
- Unstage file or hunk.
- Discard complete file with confirmation.
- Open file at line.
- Copy path.
- Unified/split mode.
- Collapse unchanged regions.

Avoid line-level staging in the first implementation. Producing valid patches from arbitrary individual lines has significantly more edge cases than file or hunk staging.

## 4. Commit composer

Pin it to the bottom so it remains available while reviewing files.

```txt
┌────────────────────────────────────────────────────────┐
│ Add resizable Git diff drawer                          │
│                                                        │
│ Introduce virtualized diffs and hunk-level staging…    │
│                                                        │
│ 3 files staged · +126 −19                Commit 3 ▾    │
└────────────────────────────────────────────────────────┘
```

Fields:

- One-line commit summary.
- Collapsible description/body.
- Staged file and line count.
- Commit button.
- Split-button menu:
  - Commit.
  - Commit and push.
  - Amend previous commit.
  - Commit without hooks, placed under an advanced submenu.

Useful Jet integration:

- A subtle `Draft message` action can ask the selected agent to generate a message from the **staged diff only**.
- Keep it as secondary text/icon, not a prominent AI gradient button.
- Show the generated message directly in the normal fields so it remains editable.

Disable commit when:

- Nothing is staged.
- Summary is empty.
- Repository is in an unresolved conflict state.
- Another Git mutation is running.

## 5. Conflict state

Conflicted files should move into a dedicated section above staged changes:

```txt
CONFLICTS                               2
  U  src/config.ts              both modified
  U  package.json               both modified
```

Selecting one switches the diff area into a three-state conflict view:

```txt
Current       Result       Incoming
```

For the first version, provide:

- Accept current.
- Accept incoming.
- Accept both.
- Open in editor.

Do not attempt a full visual merge editor inside the compact drawer initially.

## Best diff-viewer library: `@pierre/diffs`

My primary recommendation is **`@pierre/diffs`**.

It provides:

- A virtualized `CodeView` capable of rendering mixed files and diffs.
- Line-based virtualization.
- React integration.
- Syntax highlighting built around Shiki.
- Support for moving highlighting work into workers.
- Unified rendering for individual files and multi-file diff views. citeturn706201search6turn706201search8

This is a much better fit for Jet than older React diff components that eagerly render a large DOM tree.

As of July 22, 2026, its release page shows `1.2.11` as the current stable release while `1.3.0` is under beta development. Pin an exact stable version and hide the library behind a small Jet-owned adapter because its API is evolving actively. citeturn176849search2turn176849search12

```tsx
export interface JetDiffViewerProps {
  patch: string
  selectedFile?: string
  mode: "unified" | "split"
  onOpenFile(path: string, line: number): void
  onStageHunk?(hunk: DiffHunk): void
}

export function JetDiffViewer(props: JetDiffViewerProps) {
  // The rest of Jet only knows this interface.
  // @pierre/diffs remains an implementation detail.
}
```

### Alternative: CodeMirror Merge

Use `@codemirror/merge` when you need editable merge resolution rather than a read-only review interface. CodeMirror renders only the visible portion of large documents, and its merge package supports unified and side-by-side comparisons, collapsed unchanged ranges, and accepting chunks. citeturn706201search3turn706201search15

Since Jet has previously used CodeMirror, this is a good eventual conflict-editor implementation. For the ordinary Git drawer, `@pierre/diffs` should be lighter conceptually and visually closer to a modern review tool.

## Git operations: native Git through `simple-git`

Do not implement Git itself in JavaScript for a local desktop agent environment.

Use:

```txt
React UI
   ↓ typed commands
Jet Git service
   ↓
simple-git
   ↓
system git binary
```

`simple-git` is a TypeScript-compatible wrapper around the installed Git binary. It exposes status, diff, commit, log, push and arbitrary raw commands while retaining native Git behavior. It also supports process concurrency, timeouts, progress events, and aborting commands. citeturn281411view1

Recommended commands:

```bash
git status --porcelain=v2 -z --branch
git diff --no-color --patch --find-renames -- <path>
git diff --cached --no-color --patch --find-renames -- <path>
git add -- <path>
git restore --staged -- <path>
git diff --numstat
git log --format=...
```

For hunk staging:

```bash
git apply --cached --recount -
```

For hunk unstaging, generate the reverse patch:

```bash
git apply --cached --reverse --recount -
```

Expose Git through a narrow service:

```ts
interface GitService {
  status(repoPath: string): Promise<RepositoryStatus>

  diff(
    repoPath: string,
    options: {
      path?: string
      staged: boolean
    },
  ): Promise<string>

  stageFiles(repoPath: string, paths: string[]): Promise<void>
  unstageFiles(repoPath: string, paths: string[]): Promise<void>

  stagePatch(repoPath: string, patch: string): Promise<void>
  unstagePatch(repoPath: string, patch: string): Promise<void>

  discardFiles(repoPath: string, paths: string[]): Promise<void>

  commit(
    repoPath: string,
    input: {
      summary: string
      body?: string
      amend?: boolean
      skipHooks?: boolean
    },
  ): Promise<CommitResult>

  fetch(repoPath: string): Promise<void>
  pull(repoPath: string): Promise<void>
  push(repoPath: string): Promise<void>
}
```

## Performance rules

To keep the drawer genuinely fast:

1. Fetch status immediately, but load a patch only when a file becomes visible or selected.
2. Cache diffs by repository, HEAD, index state, file path, and staged state.
3. Cancel obsolete diff requests when users rapidly switch files.
4. Keep syntax highlighting in a worker.
5. Virtualize both the file list and diff.
6. Refresh status after Git operations rather than periodically recomputing every diff.
7. Debounce filesystem-triggered refreshes.
8. Return structured errors for hooks, conflicts, authentication, and rejected pushes.
9. Never run shell-interpolated commands; pass arguments as arrays.
10. Keep all destructive actions outside the primary click path.

The final stack I would use is:

```txt
shadcn Sheet + Resizable + ScrollArea
@pierre/diffs
simple-git + native git
Zustand or the existing Jet store
desktop command boundary for filesystem/process access
```