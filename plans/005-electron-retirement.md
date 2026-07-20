# Plan 005: Close parity gaps before retiring Electron

> **Executor instructions**: This is a retirement gate, not permission to delete Electron immediately. Keep Electron until every gate is proven on the supported platform matrix.
>
> **Drift check**: `git diff --stat a52fab2..HEAD -- apps/gharargah apps/jet-desktop packages/jet-host packages/jet-host-client packages/jet-app/src/load-workspace-init.ts tests package.json .github/workflows/ci.yml`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-tauri-verification.md`, `plans/003-tauri-host-efficiency.md`, `plans/004-premium-motion.md`
- **Category**: migration / correctness
- **Planned at**: commit `a52fab2`, 2026-07-11
- **Status**: DONE (2026-07-12) — user override: Electron deleted; Tauri is sole shell. Remaining agent/packaging gaps tracked separately.

## Why this matters

Removing Electron is a valid goal, but Tauri is not yet behaviorally equivalent. The native suite excludes agents, six shared cases fail, critical flows are skipped, Tauri is absent from CI, and the Rust agent host is a partial mock-like implementation. Deletion before contract parity would remove the only proven implementation and make regressions hard to diagnose.

## Current state

- `playwright.config.ts:31` excludes all agent/agent-launch/workspace-open-via-agent cases from Tauri.
- `host/agents.rs:302-329` advertises cursor, Claude, and Codex but returns only an `auto` model and merely checks binaries.
- `host/agents.rs:343-366` actually runs only cursor/agent, then silently falls back to a mock; Claude and Codex are never executed.
- `host/agents.rs:397-445` uses `Command::output()`, so output is buffered, not streamed, and interruption cannot terminate the child while it runs.
- `host/agents.rs:33-47,140-211,448-487` repeatedly reads/clones/rewrites the entire JSON store without per-workspace serialization or atomic replace; concurrent settings/archive/turn updates can lose data.
- `packages/jet-app/src/load-workspace-init.ts:23-49` dynamically imports absolute `init.ts`/`init.js`/`editorrc.ts`; native Tauri support and CSP/custom-protocol behavior are not covered by tests.
- `package.json:17-19` still makes Electron the default release and installs/rebuilds Electron on every install.
- Tauri production config uses product name `Gharargah-Tauri`, version `0.0.1`, and currently has no required release/notarization/update/platform CI gate.

## Scope

**In scope**: a shared host contract suite, Tauri agent parity, workspace-init/extensibility compatibility, launch/menu/dialog/terminal/LSP/search/git/native chrome parity, release packaging and platform gates, final default switch and later Electron deletion.

**Out of scope**: deleting Electron before gates pass, redesigning the product, adding new agent providers beyond those Electron already supports.

## Steps

### 1. Define executable parity contracts

List every `GharargahHostAPI` method/event and every user-visible shell behavior. Run the same contract tests against Electron's `@gharargah/host` registry and Tauri Rust. Include success/error/cancel/reload/dispose and ordering semantics, not only channel presence. Add explicit contracts for native menu, launch/second-instance/open-file, dialogs, theme chrome, filesystem watch, search, Git, tasks, LSP, terminal, agents, telemetry, and workspace init.

**Verify**: a generated parity report has no unclassified method/event; channel allowlist string tests are secondary, not the proof.

### 2. Make Tauri agents real and cancellable

Implement cursor/Claude/Codex driver descriptors with model discovery and selected provider/model routing equivalent to Electron. Spawn with piped streaming output, parse incrementally, retain a kill handle, and make interrupt terminate the process promptly. Remove silent mock fallback outside `GHARARGAH_AGENT_MOCK=1`. Serialize per-workspace mutations and persist with temp-file + fsync/atomic rename; remove completed turns from `active_turns`.

**Verify**: mock agent, real available-provider smoke, streaming partial updates, interrupt latency, provider/model selection, concurrent archive/settings, crash recovery, and corrupted-store recovery tests pass.

### 3. Prove extensibility and workspace-init behavior

Add fixtures for `.gharargah/init.js`, `.gharargah/init.ts`, and `.gharargah/editorrc.ts` that register a command, keymap, and editor extension. Decide and document the supported native execution model. Do not rely on an absolute dynamic import if the Tauri custom protocol/CSP cannot load it; choose a secure explicit compilation/loading boundary with actionable errors and safe recovery.

**Verify**: production Tauri loads every promised format, reports syntax/runtime errors in-app, and never grants arbitrary remote content native command access.

### 4. Prove release/platform readiness

Build signed/notarized macOS artifacts and installable Windows/Linux artifacts for claimed platforms; verify icons, identifiers, app name/version, single instance, file/folder launch, PATH discovery, updater policy, crash/log paths, permissions, and clean uninstall. Add platform-native CI E2E lanes and a manual release checklist for OS dialogs and signing.

**Verify**: artifacts install and pass smoke/contract tests on each supported OS; production bundle contains no E2E plugin/capability.

### 5. Run a Tauri-default soak before deleting Electron

Switch development and release defaults to Tauri while keeping Electron as a fallback for at least one stabilization period. Collect startup, idle CPU, RSS, crash, LSP/terminal/agent, and long-session results. Only then remove Electron packages, scripts, postinstall rebuilds, main/preload code, and Electron-only tests; keep shared renderer/host contracts.

**Verify**: all retirement gates below pass on two consecutive release candidates.

## Electron retirement gates

- [ ] Zero Tauri E2E failures and zero unexplained skips across supported platforms.
- [ ] All `GharargahHostAPI` methods/events pass shared behavioral contracts.
- [ ] Agents, workspace init, LSP reconnect, terminal persistence/replay, filesystem watch, search, save/dirty close, native launch/menu/dialogs all pass.
- [ ] Tauri is required in CI and has completed a default-channel soak.
- [ ] Release startup/CPU/memory budgets meet or beat the accepted Electron baseline.
- [ ] Production signing/notarization/install/update story is complete.
- [ ] No production WebDriver or over-broad development capability remains.
- [ ] User data/session/project migration is tested and reversible.

## STOP conditions

- STOP before deleting Electron if any gate is unchecked.
- STOP if Tauri requires a Node sidecar merely to recreate Electron wholesale; reassess the migration value and isolate only the irreducible capability.
- STOP if workspace code execution cannot be made secure and compatible without a product decision; present supported-format options and tradeoffs.
- STOP if platform packaging is claimed without a CI or manual verification lane on that platform.

