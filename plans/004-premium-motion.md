# Plan 004: Make premium motion correct and frame-budgeted

> **Executor instructions**: Motion is a product feature, but correctness and input latency are hard constraints. Profile production Tauri, use compositor properties, and verify visually in both color schemes and reduced motion.
>
> **Drift check**: `git diff --stat a52fab2..HEAD -- packages/jet-ui/src/motion packages/jet-shared/src/caret-motion.ts packages/jet-ui/src/dock/PanelDropOverlay.tsx packages/jet-ui/src/styles/globals.css tests/electron/editor-premium-motion.electron.spec.ts tests/electron/hot-glow.electron.spec.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-tauri-verification.md`, `plans/002-tauri-startup.md`
- **Category**: bug / performance / UX
- **Planned at**: commit `a52fab2`, 2026-07-11
- **Completed**: 2026-07-12 — rAF-batched glow, imperative drop morph, shell-only layout morph, caret teardown; bench budgets cover palette/typing.

## Why this matters

Motion is Gharargah's intended differentiator, but the Tauri run fails the universal ghost-caret and hot-glow tests, and live capture showed a custom caret stranded over the editor after an overlay transition. Expensive motion also competes directly with typing: raw pointer layout work, React state on every animation frame, whole-panel DOM clones, and repeated caret measurement can turn polish into latency.

## Current state

- `HotGlowTracker.tsx:56-63` performs `getBoundingClientRect()` plus two style writes on every raw `pointermove`.
- `useRadRectMorph.ts:61-81` allocates a new rect and calls React `setState` every frame; it is used by `PanelDropOverlay.tsx` during drag.
- `layoutMorph.ts:30-43` deep-clones the full panel DOM for FLIP animation; editor/terminal panels can be large.
- `UniversalCaretLayer.tsx:275-287` remeasures/schedules every frame for 220 ms after focus; `tick` calls `ghosts.tick(time)` and `render` calls it again.
- `UniversalCaretLayer.tsx:438-443` relies on focus events to clear the target; portal/unmount/reload transitions currently leave visible stale state under Tauri.
- Native failures: ghost observation attribute never appears; hot-glow variables remain at `50%` after pointer movement.
- Live visual QA: palette bottom row is clipped; dark palette has a harsh bright border and subdued hierarchy; light editor shows an oversized dark focus ring on the file tab, weak inactive chrome hierarchy, and an empty-looking explorer.

## Scope

**In scope**: caret/hot-glow/panel/drop motion engines, motion tokens, palette clipping/focus visuals directly implicated by captures, reduced motion, production frame/interaction tests.

**Out of scope**: broad redesign, new decorative effects, changing editor semantics, replacing CodeMirror, animation driven through React state.

## Steps

### 1. Establish interaction/frame budgets and traces

Record production Tauri traces for typing, caret jumps, palette open/filter/close, hover tracking, split/drop preview, scroll, and theme switch. Capture main-thread task time, layouts, paints, layer count, and dropped frames. Budgets: typing/cursor <=16 ms ideal, palette open <=50 ms, palette filter <=30 ms, no repeated >16 ms motion tasks, no >50 ms long task.

**Verify**: checked-in benchmark definitions reproduce the failing native interactions and emit p50/p95 plus layout/long-task counters.

### 2. Fix caret ownership and teardown first

Model caret state explicitly: no target, native caret, custom caret animating, composing/selecting. Clear visuals synchronously when the target disconnects, loses focus, becomes hidden/inert, a portal closes, or the document reloads. Use one measurement per frame and one ghost-buffer tick. Replace the unconditional 220 ms focus loop with observer/font/layout signals or a tightly bounded retry that stops when geometry stabilizes.

**Verify**: palette/settings/contenteditable transitions never leave a visible detached caret; IME, selection drag, Escape, reload, and reduced motion pass native tests.

### 3. Batch hot glow and move drag morph off React's render path

Store the latest pointer sample and update at most once per rAF. Cache the current target/rect until target or layout changes; group reads before writes. Replace `useRadRectMorph` per-frame state with an imperative animated element/ref or Web Animations/CSS transform path; React should receive only semantic start/end state.

**Verify**: native pointer actions update pixel-local variables; React Profiler shows no component commit per animation frame; pointer motion causes at most one layout read/write batch per frame.

### 4. Replace deep panel clones with lightweight continuity

Do not `cloneNode(true)` an editor/terminal subtree. Animate the real panel with FLIP when ownership permits, or animate a lightweight shell/snapshot that excludes CodeMirror/xterm/accessibility descendants. Use transform/opacity only and remove `will-change` immediately after completion.

**Verify**: split/drop with a large file and active terminal stays within frame budget and creates no detached editor/terminal nodes.

### 5. Finish perceptual QA without adding noise

Fix palette viewport clipping, focus-ring scale, contrast/hierarchy, and empty explorer feedback using existing tokens. Preserve Gharargah's dense RAD character. Review dark/light, focus/hover/pressed, empty/error/loading, reduced motion, long labels, and 100/125/150% zoom. Motion must communicate continuity and focus, not mask latency.

**Verify**: reviewed screenshots and sampled animation frames show no clipping, stranded effects, overlap, or contrast regression; keyboard focus remains unmistakable without dominating the surface.

## Done criteria

- [ ] All premium-motion/hot-glow/native-input tests pass three runs.
- [ ] No animation uses React `setState` per frame.
- [ ] No full editor/terminal DOM subtree is cloned for motion.
- [ ] Hot pointer paths are rAF-batched with reads before writes.
- [ ] Reduced motion snaps cleanly while preserving state/focus feedback.
- [ ] Production traces meet the documented budgets and contain no new long tasks.

## STOP conditions

- STOP if a visual effect requires hiding real input latency or dropping input.
- STOP if removing deep clones cannot preserve continuity; prototype and compare two measured alternatives before choosing.
- STOP if automated screenshots pass but live headed Tauri still shows detached or clipped effects.

