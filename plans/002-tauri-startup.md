# Plan 002: Remove Shiki from the Tauri startup path

> **Executor instructions**: Measure before and after on release builds. Do not hide Vite warnings or change a budget without reviewer approval.
>
> **Drift check**: `git diff --stat a52fab2..HEAD -- apps/gharargah/vite.config.ts apps/gharargah/src/bootstrap.ts packages/jet-app packages/jet-codemirror package.json tests/bench`

## Status

- **Priority**: P0
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-tauri-verification.md`
- **Category**: performance
- **Planned at**: commit `a52fab2`, 2026-07-11
- **Completed**: 2026-07-12 — Shiki off initial graph; aspirational 300/400 ms host budgets not met (main chunk + webview); regression budgets enforced.

## Why this matters

Release startup is 595 ms cold and roughly 503 ms warm, above Gharargah's sub-300 ms target. The generated HTML eagerly module-preloads `shiki-*.js`, and the bootstrap itself statically imports Vite's preload helper from that chunk. This forces a 9.85 MB minified chunk into the critical path before the editor is useful.

## Current state

- `apps/gharargah/vite.config.ts:28-38` groups both `@pierre/diffs` and all Shiki modules into a manual chunk named `shiki`.
- Generated `dist/index.tauri.html` includes `<link rel="modulepreload" ... shiki-*.js>`.
- Generated `dist/assets/index-*.js` starts with `import { _ as ... } from "./shiki-*.js"` because Rollup placed a shared preload helper in that manual chunk.
- Bundle sizes: Shiki 9.85 MB minified/1.74 MB gzip, React 836 KB, main 832 KB, CodeMirror 790 KB.
- `apps/gharargah/src/bootstrap.ts:5-8` already tries to defer the app entry with a dynamic import, but the emitted preload graph defeats the intent.

## Scope

**In scope**: Tauri Vite chunking, lazy import boundaries for syntax highlighting/git diff, startup benchmark/reporting, and bundle/startup regression tests.

**Out of scope**: changing CodeMirror, deleting Shiki, changing syntax colors, Rust host micro-optimization, Electron removal.

## Steps

### 1. Add a failing startup-graph guard

Create a build assertion that parses the generated HTML and bootstrap chunk. It must fail if Shiki, `@pierre/diffs`, xterm, or optional overlays are statically imported/module-preloaded before their feature is requested. Record compressed and uncompressed initial graph sizes.

**Verify**: the guard fails on commit `a52fab2` specifically because Shiki is in the initial graph.

### 2. Correct the chunk boundaries

Separate `@pierre/diffs` from syntax packages. Use explicit/lazy feature boundaries and Rollup settings that keep shared helpers in a small neutral bootstrap/vendor chunk rather than a feature chunk. Ensure language modules load on first matching editor intent and diff code loads on first Git diff intent. Prefetch only on user intent, not unconditionally.

**Verify**: generated HTML and bootstrap contain no `shiki`, `pierre`, or `xterm`; opening TS/Go/Rust still highlights correctly and Git diff/terminal still work.

### 3. Reduce initial parse/evaluation further only with evidence

Use a bundle analyzer to identify what remains in the 832 KB main and 836 KB React chunks. Split rare overlays/agent UI/settings where they dominate startup, but do not create a code/data waterfall on common editor open. Keep shell and first editor path together when splitting would delay first interaction.

**Verify**: attach analyzer output and before/after initial JS bytes. Each new split has a feature test.

### 4. Turn startup into a budgeted regression test

Refactor `startup-bench.mjs` to write run artifacts to an explicit temporary/output directory in CI and compare medians/p95 against a checked-in budget. Separate process-to-webview, renderer bootstrap, app-ready, workspace-ready, and editor-ready marks. Run enough warm samples for a stable median and report machine/commit/build mode.

**Verify**: on the audit machine, warm host-ready median is <=300 ms and cold <=400 ms, or the PR documents the remaining measured blocker and gets explicit budget approval.

## Done criteria

- [ ] `pnpm -r typecheck` and `pnpm --filter gharargah build` pass.
- [ ] Initial HTML/bootstrap do not preload or statically import Shiki/diffs/xterm.
- [ ] Initial compressed JS and startup metrics improve and are recorded in a before/after table.
- [ ] Syntax, Git diff, terminal, palette, and editor-open native tests pass.
- [ ] CI fails on an initial-graph or startup-budget regression.

## STOP conditions

- STOP if a proposed split makes first editor interaction slower despite fewer bytes.
- STOP if syntax behavior changes or a language is lost.
- STOP if numbers are from dev/debug builds or incomparable machine/power states.

