# RAD Debugger — UI Animations & Interaction Effects

Reference for agents implementing Jet shell polish. Source: `.raddebugger/src/ui/` (framework) + `.raddebugger/src/raddbg/` (application wiring + draw pass).

**Design philosophy:** Actions are instant; animations are visual-only. Every transition uses **exponential smoothing** toward a target — not springs, not CSS ease curves. State changes commit immediately; the GPU catches up frame-by-frame.

---

## 1. Animation engine

### 1.1 Core formula

All smoothed values use the same per-frame integrator:

```
current += rate * (target - current)
```

`rate` is derived from frame delta (`dt`) and a half-life constant:

```
rate = 1 - pow(2, (-N * dt))
```

When animations are disabled via settings, `rate = 0` → values snap instantly.

| Rate variable | Setting gate | N (half-life factor) | Typical use |
|---|---|---|---|
| `catchall_animation_rate` | `animations` | 60 | Hover (`hot_t`), release (`active_t` decay), scroll fades, scope pins |
| `menu_animation_rate` | `animations` × `menu_animations` | 70 | Panels, tabs, drop sites, toggles, floating views (anchored) |
| `menu_animation_rate__slow` | `animations` × `menu_animations` | 50 | Scope depth color, floating views (unanchored) |
| `entity_alive_animation_rate` | `animations` × `menu_animations` | 30 | Thread/BP line extensions, task indicators |
| `rich_hover_animation_rate` | `animations` × `menu_animations` | 50 | Entity/BP hover fill width |
| `scrolling_animation_rate` | `animations` × `scrolling_animations` | 60 | Scroll offset (`view_off`) |
| `tooltip_animation_rate` | `animations` × `tooltip_animations` | 60 | Tooltip open/close |
| Theme color lerp | always (when animating) | 30 | Theme pattern cache RGBA |
| `disabled_t` lerp | always | 30 (`slow_rate`) | Disabled overlay |
| Popup `popup_t` | `menu_animations` | 30 | Confirmation dialogs |

**Source:** `raddbg_core.c` ~17828; wired into `UI_AnimationInfo` at ~5589.

### 1.2 Keyed animation cache (`ui_anim`)

Arbitrary scalar properties animate via keyed nodes:

```c
F32 t = ui_anim(key, target, .rate = rd_state->menu_animation_rate, .initial = 0, .reset = 0);
```

- Persists across frames keyed by `UI_Key`.
- `.reset = 1` snaps `current` to `.initial` (used on layout reset / first 5 frames).
- `.epsilon` default 0.005 — snaps when within epsilon.
- `.rate = 1` or at target → instant snap.

**Jet equivalent:** Framer Motion `useSpring` with high stiffness is close, but RAD uses **fixed exponential decay** — map `N=60, dt≈0.016` → ~94% convergence per frame at 60fps. For CSS: `transition` with ~120–180ms and `ease-out` approximates hover; for panel morphs use ~220ms.

### 1.3 Repaint driver

`ui_state->is_animating` stays true while any box `_t` delta > 0.01, any `ui_anim` node is mid-lerp, tooltip/ctx-menu open_t is mid-lerp, or theme colors are mid-lerp. RAD requests another frame until settled.

**Jet:** keep `requestAnimationFrame` / Framer `onAnimationComplete` loops or CSS transitions that block "done" until settled.

---

## 2. Per-box interaction weights

Every `UI_Box` persists these floats (`ui_core.h`):

| Weight | Driven by | Rate | Notes |
|---|---|---|---|
| `hot_t` | Mouse hovering this box (or drop-hot) | `hot_animation_rate` | 0→1 smooth |
| `active_t` | Left mouse held while this box was pressed | **Snap to 1 on press**; decay on release | Asymmetric |
| `disabled_t` | `UI_BoxFlag_Disabled` | `slow_rate` | Overlays at `disabled_t * 0.3` alpha |
| `focus_hot_t` | Keyboard nav focus candidate | `focus_animation_rate` (= **1.0 instant** in RAD) | |
| `focus_active_t` | Keyboard/text edit focus | instant | |
| `focus_active_disabled_t` | Focus blocked by ancestor | instant | |

**Active press asymmetry** (`ui_core.c` ~1471):

```c
box->active_t = is_active ? 1.f : box->active_t + (active_rate * ((F32)is_active - box->active_t));
```

Press feels **immediate**; release **eases out**. Jet should mirror: `active:scale-[0.98]` instant on `:active`, transition out on release.

**Group hot sharing:** boxes with matching `group_key` inherit `hot_t` from the group box — hover ripple stays coherent across composite widgets (e.g. toggle switch sub-boxes).

---

## 3. Box flags → rendered effects

Flags in `UI_BoxFlag_*` (`ui_core.h`). Draw implementation: `raddbg_core.c` box tree draw pass ~9026–9394.

### 3.1 `UI_BoxFlag_DrawHotEffects`

Applied to: buttons, tabs, list rows, icon buttons, binding chips, drop sites, toggle switches, sliders, help icons, settings cells.

**Effective hover strength:**

```
t = hot_t * (1 - effective_active_t)   // active suppresses hover glow
```

| Layer | Visual | Parameters |
|---|---|---|
| Drop shadow (behind bg) | Theme drop shadow | `alpha *= t * bg.w`; offset (4,4); pad 8px; corner 8px |
| Hot brighten (only when `ui_hot_key` matches) | Theme `hover` color | `alpha = 0.015` flat fill |
| Mouse-follow soft circle | Theme `hover` color | Center = mouse; radius = `min(max(box dim), font_size * 24)`; `alpha = 0.025 * hot_t` (full if hot) |
| Border brighten | Theme `hover` on border pass | `alpha = 0.01 * hot_t` (skipped if currently hot key) |

**Jet mapping:**

- List/button hover: subtle background lift + optional radial highlight tracking pointer (CSS `radial-gradient` at `--mouse-x/y` or skip for simplicity).
- Use `--sidebar-accent` / `hover:bg-sidebar-accent` for flat hover; add `box-shadow` fade for depth.
- Suppress hover styling while `:active`.

### 3.2 `UI_BoxFlag_DrawActiveEffects`

Applied to: `ui_button`, sort headers, binding buttons, icon buttons, line margin (code), some cells.

| Layer | Visual | Parameters |
|---|---|---|
| Inset top shadow | Black | height = `min(box_h * 0.6 * active_t, font_size * 2)`; `alpha = 0.5 * active_t` |
| Inset bottom highlight | White | same height; `alpha = 0.08 * active_t` |
| Inset left/right shadow | Black | width same formula | 

Reads as a **physical button press** — dark top/left, light bottom.

**Jet mapping:** `jet-press` class or `active:brightness-95 active:shadow-inner` on clickable surfaces. Keep press instant (see §2).

### 3.3 Focus overlays

| Flag / condition | Visual | Parameters |
|---|---|---|
| `focus_hot_t > 0.01` + clickable | Fill overlay | Theme tag path `focus` + `overlay`; `alpha *= focus_hot_t` |
| `focus_active_t > 0.01` + clickable | Border ring | Theme `focus` + `border`; 1px; `alpha *= focus_active_t` |
| `DisableFocusOverlay` / `DisableFocusBorder` | Skip | Used on ctx menu root, some chrome |

**Jet mapping:** `ring-2 ring-ring` for focus-visible; `outline-none` + keyboard nav ring. RAD focus hot is instant — no fade.

### 3.4 Disabled

Semi-transparent wash: `base_background @ alpha = disabled_t * 0.3` over entire box.

### 3.5 Structural / motion flags

| Flag | Behavior |
|---|---|
| `DrawDropShadow` | Static shadow (4,4) pad 8 — tooltips, floating panels, toggle knob |
| `DrawBackgroundBlur` | Gaussian blur pass; strength `blur_size * (1 - transparency)` |
| `AnimatePosX/Y` | `fixed_position_animated` lerps toward `fixed_position` at `default_animation_rate` |
| `DrawFadeTop/Bottom/Left/Right` | 5% of box dim gradient scrim; `ui_anim` target 1 at `catchall_rate` |
| `Squish` + `SquishAnchored` | Scale transform `(1-squish)` about anchor; used for open/close |
| `Transparency` | Multiplies draw alpha — used with open_t for fade-in |

---

## 4. Overlay open/close choreography

Shared pattern for **tooltips**, **context menus**, **popups**, **drop sites**, **floating views**:

```
squish     = 0.1 * (1 - open_t)      // scale 90% → 100%
transparency = 1 - open_t             // 0 → 1 opacity
blur       = max_blur * open_t        // popups/tooltips
```

| Overlay | open_t driver | Extra |
|---|---|---|
| Tooltip | `tooltip_open_t` ← `tooltip_animation_rate` | Follows mouse +15px; `DrawBackgroundBlur` + `DrawDropShadow`; 500ms delay for truncated text (`ui_string_hover_active`) |
| Context menu | `ctx_menu_open_t` ← `menu_animation_rate` | Anchored to click point; `SquishAnchored`; kills on outside click |
| Confirmation popup | `popup_t` ← menu rate | Full-window scrim blur `10 * popup_t`; content fade |
| Drop site chip | `ui_anim(..., "open_t")` | Same squish/transparency |
| Floating view | `ui_anim(..., "floating_view_open_%p")` | Anchored: fast rate; free-floating: slow rate; corner radius larger when footer |

**Jet mapping:** Already partially in `packages/jet-ui/src/motion/tokens.ts` (`overlayEnter`: opacity + scale 0.96 + blur). Align durations:

| RAD (approx @60fps, N=60–70) | Jet token |
|---|---|
| ~150ms (catchall/hot) | `--jet-motion-fast` (150ms) |
| ~200ms (menu/tooltip) | `--jet-motion-overlay` (200ms) |
| ~220ms (panel rect) | `--jet-motion-panel` (220ms) |

Add **scale-from-0.9** squish (RAD uses 10% squish, not 4% zoom) for menus/tooltips if matching RAD literally.

---

## 5. Widget catalog

### 5.1 Generic UI widgets (`ui_basic_widgets.c`)

| Widget | Hot | Active | Other motion |
|---|---|---|---|
| `ui_button` | ✓ | ✓ | Standard reference button |
| `ui_hover_label` | border toggled on hover | — | No DrawHotEffects — border only when hovering |
| `ui_line_edit` | ✓ | — | Cursor X animated (`ui_anim cursor_off_px`); trail rect between old/new X; cursor/selection alpha ∝ `focus_active_t` |
| `ui_expander` | cursor HandPoint | — | Instant caret swap `>` / `v` |
| `ui_sort_header` | — | ✓ | Background + active inset when clickable |
| `ui_sat_val_picker` / `ui_hue_picker` | cursor HandPoint | indicator size ∝ `active_t` | Drag updates value; color tooltip on drag |
| `ui_table` column boundary | cursor LeftRight | — | No anim on drag — live resize |
| Scroll list arrows | icon font | — | View scroll animated via `scroll_animation_rate` |

### 5.2 RAD chrome widgets (`raddbg_widgets.c`, `raddbg_core.c`)

| Element | Animation details |
|---|---|
| **Tab bar** | Each tab width → `ui_anim(tab_width_%p)` at `menu_animation_rate`; selected tab in focused panel gets extra close-button width; inactive tag styling |
| **Panel splits** | Panel rect `%` components each `ui_anim(panel_%p_x0..y1)`; reset on window resize / first 5 frames / boundary change |
| **Tab/panel drop sites** | `open_t` squish+fade; when drop-hot, preview rect expands from center (`drop_site_v0..v3` from center → target) |
| **Toggle switch** | `toggle_t` = `ui_anim(..., is_toggled)`; check icon width = `pct(toggle_t)`; knob track uses spacer `pct(1-toggle_t)`; tag `good_pop` when on |
| **Slider** | Hot effects on track; **value moves instantly** (no spring); knob `DrawDropShadow` |
| **Command binding chip** | Hot + active; tag `pop` when rebinding, `bad_pop` on conflict |
| **Icon button** | Hot + active + border + bg |
| **Loading overlay** | `loading_t` fades whole overlay; sin-wave sliding bar (`sin(time/1.8)`) with trail; progress fill optional; blur `10 * loading_t` |
| **Settings/help cell** | Optional hot on button areas; revert icon with tooltip |
| **Search row** (query UI) | `search_row_open_t` animates height + transparency |
| **Floating views** | `open_t` + blur/shadow container; loading overlay per view |
| **Task bar items** | `task_anim_%id` at entity_alive rate |
| **Top bar system status** | Pulsing loading indicator |

### 5.3 Code / debugger-specific (`rd_code_slice`, `raddbg_views.c`)

| Element | Animation details |
|---|---|
| **Text cursor** | `cursor_y_px`, `cursor_off_px` animated; **trail** rect between frames with shear + directional alpha fade; disabled while mouse-drag selecting |
| **Thread glyph (margin)** | `alive_t` → horizontal line width `font * 260 * alive_t`; `hover_t` → fill width `font * 22 * hover_t` at 15% thread color; selected glow uses `alive_t` |
| **Breakpoint glyph** | Same hover/alive pattern; 50% hover alpha; remap vertical bar on address remap |
| **Scope depth guide** | `scope_line_color_t` at slow menu rate |
| **Scope block highlight** | `catchall_rate` fade-in per scope key |
| **Watch pin** | `pin_t` at catchall rate |
| **Token lookup flash** | `lookup_color_mix_t` → 1 on lookup |
| **Hover line highlight** | Instant bg at 20% (no lerp) when debug info matches |
| **Memory/disasm annotations** | Hover size pulse: `cell_w/4 + cell_w/8 * anim(hovered)` |
| **Memory zoom** | `ui_anim(..., zoom_target)` per view |
| **Line margin click** | `DrawActiveEffects` only |

### 5.4 Lists & scrolling

- `view_off` → `view_off_target` at `scroll_animation_rate` (snap within 2px).
- Scrollable regions: `DrawFadeTop/Bottom/Left/Right` when content overflows — fade extent = 5% of viewport, animated in at catchall rate.
- **No momentum** — target stops when input stops; smooth catch-up only.

---

## 6. Interaction semantics (non-visual but coupled)

| Behavior | Detail |
|---|---|
| **Hover cursor** | Each box can set `hover_cursor` (Pointer, HandPoint, IBar, LeftRight, UpDownLeftRight, Disabled). Active drag keeps active box cursor. |
| **Hot key** | Single global `hot_box_key`; deepest eligible box under mouse wins. |
| **Active key** | Left press captures box until release; drives `active_t`. |
| **Drop hot** | Separate `drop_hot_box_key` for DnD; also drives `hot_t`. |
| **Click outside ctx menu** | Closes menu (competes with animation) |
| **Truncated text tooltip** | 500ms dwell before `ui_string_hover_active` |
| **Rich hover tooltip** | Immediate for entities, files, eval hover — anchored to `tooltip_anchor_key` |
| **Theme colors** | `ui_color_from_tags_key_*` returns **animated** RGBA from pattern cache (slow_rate) — theme switches cross-fade |

---

## 7. Jet implementation checklist

Use this when adding or auditing Jet UI motion.

### 7.1 Global tokens (extend `jet-ui/src/motion/tokens.ts` + `globals.css`)

```css
/* Exponential half-life approximations @ 60fps */
--jet-motion-hot: 140ms;        /* catchall N=60 */
--jet-motion-menu: 200ms;       /* menu N=70 */
--jet-motion-slow-menu: 280ms;  /* N=50 */
--jet-motion-scroll: 140ms;     /* scroll N=60 */
--jet-motion-entity: 350ms;     /* N=30 */
--jet-motion-squish-scale: 0.9; /* RAD 10% squish */
```

### 7.2 Reusable interaction classes

| Class / component | RAD source | Implementation hint |
|---|---|---|
| `jet-interactive-row` | DrawHotEffects on lists | `hover:bg-sidebar-accent`, optional subtle shadow |
| `jet-press` | DrawActiveEffects | `active:scale-[0.99] active:brightness-[0.97]` — **no transition on active** |
| `jet-focus-ring` | focus border | `focus-visible:ring-2 ring-ring` |
| `jet-overlay-enter` | tooltip/menu/popup | opacity + scale(0.9→1) + backdrop-blur |
| `jet-disabled` | disabled_t | `opacity-40 pointer-events-none` with 200ms fade |
| `jet-scroll-fade` | DrawFade* | mask-image linear gradient at edges |

### 7.3 Component-specific Jet targets

| Jet component | Priority effects |
|---|---|
| **PanelDock** | Panel rect morph (`menu_rate`); drop site preview expand-from-center; tab width animation |
| **Command palette** | Overlay squish+fade+blur (portal) |
| **Dialog / Confirm** | `popup_t` pattern — scrim blur + content fade |
| **Popover / Tooltip** | 500ms delay for truncated; otherwise 200ms squish enter |
| **Sidebar rows** (explorer, location list) | Hot highlight; no active inset unless button |
| **Tabs** | Width morph for active tab; hot underline/glow |
| **Editor cursor** | Fleury trail already in `@jet/codemirror`; match RAD directional fade on trail |
| **Status zones** | Hover only (ghost button) |
| **Split gutter** | Cursor LeftRight; **no** animation on drag (live) |

### 7.4 Reduced motion

RAD gates all rates via settings → `rate = 0`. Jet: respect `prefers-reduced-motion` → snap all `_t` to target, skip squish/blur/trail, keep functional focus rings.

---

## 8. Key source locations

| Topic | File | Lines (approx) |
|---|---|---|
| Box flags & `_t` fields | `src/ui/ui_core.h` | 323–440, 556–580 |
| Animation tick | `src/ui/ui_core.c` | 1380–1517 |
| `ui_anim` cache | `src/ui/ui_core.c` | 3220–3282 |
| Tooltip/menu squish | `src/ui/ui_core.c` | 1143–1156, 2003–2008 |
| Draw hot/active/focus | `src/raddbg/raddbg_core.c` | 9026–9394 |
| Rate computation | `src/raddbg/raddbg_core.c` | 17820–17835 |
| Panel/tab/drop anim | `src/raddbg/raddbg_core.c` | 7680–8450, 7966–8033 |
| Code cursor trail | `src/raddbg/raddbg_widgets.c` | 2885–2934 |
| Thread/BP hover | `src/raddbg/raddbg_widgets.c` | 1092–1230 |
| Toggle/slider | `src/raddbg/raddbg_widgets.c` | 3803–3958 |
| Basic button | `src/ui/ui_basic_widgets.c` | 76–88 |
| Jet motion tokens (existing) | `packages/jet-ui/src/motion/tokens.ts` | — |

---

## 9. Anti-patterns (don't copy blindly)

1. **Don't spring everything** — RAD rarely springs; panel/tab width uses same exponential lerp as hover.
2. **Don't animate drag deltas** — sliders, splitters, column boundaries update live.
3. **Don't fade focus** — keyboard focus rings appear instantly (`focus_animation_rate = 1`).
4. **Don't animate text/content** — only chrome; buffer text is immediate.
5. **Don't block clicks until animation finishes** — ctx menu accepts input while `open_t < 1`.
6. **Don't use hover alone for tooltips with search** — truncated hover needs dwell time + content assertion (see AGENTS.md anti-tautology rules).

---

## 10. Quick reference: effect → `_t` / rate

```
Hover background/border/shadow     hot_t          catchall (N=60)
Button depress inset               active_t       snap 1, decay catchall
Keyboard focus fill                focus_hot_t    instant
Keyboard focus ring                focus_active_t instant
Grayed out                         disabled_t     slow (N=30)
Menu/tooltip appear                open_t         menu/tooltip rate + squish
Panel resize/move                  ui_anim rect   menu (N=70)
Scroll position                    view_off       scroll (N=60)
Tab width                          ui_anim width  menu (N=70)
Toggle knob slide                  toggle_t       menu (N=70)
Entity/BP hover stripe             hover_t        rich_hover (N=50)
Entity/BP appear line              alive_t        entity (N=30)
Theme color change                 current_rgba   slow (N=30)
```

This document is the canonical agent reference for RAD-aligned motion in Jet. When implementing, prefer matching **rates and asymmetry** (instant press, smooth release) over copying exact alpha values — theme tokens differ, but the **timing identity** is what makes RAD feel responsive.
