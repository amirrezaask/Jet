# @jet/ui — Design System

Unified UI primitives + shells for every Jet surface. Shadcn-derived, semantic tokens, single motion + typography scale.

## Public surface

- `@jet/ui` — high-level shells (overlays, dialogs, panels, tabs, editor host).
- `@jet/ui/primitives` — shadcn primitives (`Button`, `Input`, `Badge`, `Dialog`, `Popover`, `Tooltip`, `DropdownMenu`, `ContextMenu`, `Kbd`, `Card`, `Empty`, `Item`, `Tabs`, `Separator`, `ScrollArea`, `AlertDialog`, `Drawer`, `Sheet`, `Sidebar`, `Resizable`, `Checkbox`, `Toggle`, `Menubar`, `Skeleton`, `Sonner`, `Spinner`, `Collapsible`, `Label`).
- `@jet/ui/styles.css` — theme tokens + globals.

**Apps must never import shadcn primitives from `@jet/ui/src/components/ui/*` directly.** Import from `@jet/ui/primitives`.

## Design tokens

Defined in `src/styles/globals.css` under `@theme inline` + `:root` / `.dark`.

### Color
Semantic: `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar-*`. Never hardcode hex outside these files.

### Radius
`--radius: 0.375rem` → `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`. Tailwind: `rounded-sm/md/lg/xl`.

### Typography
Scale (rem, ~px):
- `text-4xs` — 0.62rem (~10px)
- `text-3xs` — 0.7rem (~11px)
- `text-2xs` — 0.77rem (~12px)
- `text-xs` — 0.85rem (~14px)
- `text-sm` — 0.92rem (~15px)
- `text-base` — 1rem (~16px)
- `text-lg` — 1.15rem (~18px)
- `text-xl` — 1.85rem (~30px)

Never write `text-[Npx]`. If a size is missing from the scale, add a token — don't inline.

Fonts: `--font-sans` Geist, `--font-mono` Geist Mono.

### Motion
`jetMotion` (from `@jet/ui`) is the single source of animation timings. CSS vars: `--jet-motion-fast/hot/menu/overlay/panel/slow-menu/scroll/entity`. Never hardcode `duration-150` / `.15s`; reference the token.

Reduced motion handled globally via `prefers-reduced-motion` in `globals.css`.

### Icons
Only `lucide-react`. Default size class: `size-4`. Do not import other icon libraries.

## Shells

### Overlay palettes → `PaletteShell<T>`

Location: `src/components/palette/PaletteShell.tsx`.

All "Dialog + Command list + input + result" palettes MUST use this. Adapters:
- `CommandPalette`
- `BufferListOverlay`
- `OutlineOverlay`
- `QuickOpenOverlay`
- `ProjectSwitcherOverlay`

Exceptions (bespoke): `CdOverlay` — carries interactive path input, ghost autocomplete, footer hint bar, top-right primary button, and file/dir mode. All file/folder open flows (openFile, openFolder, cd, addWorkspace, switchFolder, folderPicker) route through it.

#### Adding a new palette

```tsx
import { PaletteShell, type PaletteShellItem } from "@jet/ui"

const items: PaletteShellItem<MyItem>[] = data.map(x => ({
  key: x.id,
  value: `${x.name} ${x.hint}`,
  data: x,
}))

<PaletteShell
  open={open}
  onOpenChange={onOpenChange}
  title="My palette"
  description="Search my things…"
  placeholder="Filter…"
  maxWidth="md"              // xs | sm | md | lg | xl
  items={items}
  onSelect={item => run(item)}
  emptyLabel="No matches."
  renderItem={item => <span>{item.name}</span>}
/>
```

Async? Provide `query` + `onQueryChange` + `shouldFilter={false}` + optional `statusRow`.

### Modal input → `PromptDialog`

Single-input modal (line jump, rename, etc.). `GotoLineModal` is an adapter.

### Confirm → `requestConfirm()` + `<ConfirmDialogHost/>`

Only path for destructive confirms. Never `window.confirm`.

### Popovers

- Panel-anchored floating: `PanelFloatingPopover` (used by `FindReplacePopover`).
- Anchored menu (button-attached): shadcn `Popover` from `@jet/ui/primitives`.

### Context menus

`createContextMenuHost()` + `dispatchContextMenuAt()` from `@jet/ui`. Used by `EditorContextMenu` (via `registerEditorContextMenuHandler` / `showEditorContextMenuAt`).

## Surface primitives

- `Text` — variants: `body | label | caption | micro | nano | code`. Replaces arbitrary `text-[Npx]`.
- `Surface` — variants: `flat | raised | overlay | inset`. Base for panels, cards, agent message rows.

## Rules

1. Never import shadcn primitives outside `@jet/ui`. Use `@jet/ui/primitives`.
2. Never inline color hex or arbitrary Tailwind color values (`bg-[#...]`, `text-[#...]`). Add semantic token in `globals.css` if missing.
3. Never inline `text-[Npx]`. Extend `--jet-fs-*` scale + `@theme inline` mapping instead.
4. Never hardcode animation duration ms. Use `jetMotion` or `--jet-motion-*`.
5. Palettes use `PaletteShell`, prompts use `PromptDialog`, confirms use `requestConfirm`. Bespoke only with justification.
6. Icons come from `lucide-react`. No other icon libraries.

## Sequencing when adding new surfaces

1. Reach for `@jet/ui/primitives` first.
2. If a pattern already has a shell (`PaletteShell`, `PromptDialog`, `ConfirmDialogHost`, `PanelFloatingPopover`), use it.
3. If none fits, add the surface locally BUT extract a shell to `@jet/ui` before the second usage lands.
