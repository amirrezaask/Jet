# Plan 001: Establish release-grade Tauri verification

> **Executor instructions**: Follow every step and verification gate. Do not weaken assertions, increase timeouts, add sleeps, or mark failures flaky to make the suite green. Update `plans/README.md` when complete.
>
> **Drift check**: `git diff --stat a52fab2..HEAD -- playwright.config.ts package.json tests/tauri tests/shell tests/electron .github/workflows/ci.yml apps/gharargah/src-tauri/Cargo.toml apps/gharargah/src-tauri/src/lib.rs`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tests / DX
- **Planned at**: commit `a52fab2`, 2026-07-11
- **Completed**: 2026-07-12 — CI + critical-path restore done; full WDIO service rewrite STOP'd (adapter sufficient). Agents E2E excluded by user.

## Why this matters

The native suite is broad but not trustworthy enough to gate a shell migration: it currently reports 64 pass, 13 skip, and 6 fail, takes 9.3 minutes serially, is absent from CI, and uses a home-grown WebDriver client that simulates several pointer/keyboard operations in the DOM. Official Tauri guidance now recommends WebdriverIO's Tauri service with the embedded provider, which works across macOS, Windows, and Linux and manages the app/driver lifecycle. Playwright should remain the fast renderer and Electron regression layer; native Tauri behavior should use the supported WebDriver stack with shared scenario contracts.

## Current state

- `playwright.config.ts:28-34` re-runs Electron specs as `tauri-e2e`, serially, while excluding all agent flows.
- `tests/tauri/webdriver.cjs:91-136` implements synthetic `sendKeys` by assigning values and dispatching events instead of using native WebDriver element actions.
- `tests/tauri/run-ui-suite.mjs:1-307` is a second five-flow smoke suite outside the main test abstraction.
- `.github/workflows/ci.yml:8-56` runs TypeScript, Electron, and Electron benchmarks, but no Rust or Tauri job.
- Current native failures: universal ghost caret, hot glow pointer tracking, LSP reload/reconnect, LSP references, parameter-hints retrigger, and terminal persistence/replay.
- Current skips include dirty-close, save persistence, search/location-list, open-file overlay, project switching, native window dragging in headless mode, terminal DnD, and flaky LSP/terminal cases.
- Official references: https://v2.tauri.app/develop/tests/webdriver/ and https://webdriver.io/docs/desktop-testing/tauri/plugin-setup/.

## Scope

**In scope**: `tests/tauri/**`, `tests/shell/**`, Tauri-specific test setup in `tests/electron/**`, `playwright.config.ts`, `package.json`, relevant dev dependencies, Tauri E2E feature/plugin wiring, and `.github/workflows/ci.yml`.

**Out of scope**: product behavior fixes except minimal test hooks; removing Electron; production-enabling the WebDriver plugin; changing app visuals.

## Steps

### 1. Adopt the supported embedded Tauri driver

Configure `@wdio/tauri-service` with `driverProvider: "embedded"`, the release E2E binary, isolated `GHARARGAH_E2E_USER_DATA`, and deterministic locale/viewport. Use `tauri-plugin-wdio-webdriver` only under the existing `e2e` Cargo feature and E2E capability. Remove `tests/tauri/webdriver.cjs` and the duplicate `run-e2e.mjs`/`run-ui-suite.mjs` after equivalent scenarios run through WDIO.

**Verify**: a single native smoke command opens the real release Tauri binary on macOS without an external driver and exits 0.

### 2. Preserve shared scenarios without pretending WDIO is Playwright

Extract shell-independent scenario functions/data from Electron specs where practical. Keep Playwright assertions for Playwright targets and WDIO assertions/actions for native Tauri. Do not emulate `page.mouse`, `keyboard`, focus, hover, or text input with `dispatchEvent`; use WebDriver actions/elements. Retain `window.__gharargahAgent` only for deterministic setup/state inspection, not as proof of the user interaction itself.

**Verify**: hot-glow, focus, drag, typing, Escape, and shortcuts use native WebDriver actions; `rg "dispatchEvent|execCommand\(\"insertText" tests/tauri` finds no interaction emulation.

### 3. Turn skipped critical paths into deterministic tests

Use per-test temporary copies for write/save flows; condition-based waits for FFF/LSP; scoped row assertions from the repository's list helpers; and headed-only separation for actual native window movement. Restore at minimum dirty close, save, project search, location list commands, open-file overlay, project switcher, terminal replay, LSP reconnect/references/signature help, and mock agents.

**Verify**: the release Tauri suite has zero unexpected skips. Explicit platform skips must name the missing native capability and be counted in the reporter.

### 4. Add console, crash, screenshot, and visual evidence

Fail on new frontend errors, unhandled exceptions, backend panics, failed resource loads, or app exit. Capture screenshots and state on failure. Add reviewed screenshots for dark/light shell, palette, editor, terminal, settings, search results, empty/error states, and reduced-motion mode. Add a real native headed lane for macOS titlebar drag/traffic lights.

**Verify**: deliberately injected console error and Rust panic each fail the harness; a forced assertion produces screenshot + frontend/backend logs.

### 5. Put Tauri in CI without rebuilding per test

Add cached Rust/pnpm jobs. Build the E2E binary once per job, then reuse it. Run embedded WebDriver on macOS and at least one Linux `xvfb`/WebKit lane; add Windows when the product claims Windows support. Split fast renderer tests from native contract tests so PR feedback is not 9+ minutes of serial app launches.

**Verify**: CI runs `cargo test`, the Tauri native suite, and a release build; no job relies on a developer's global CLI except explicitly installed language servers.

## Test plan and done criteria

- [ ] `pnpm -r typecheck` exits 0.
- [ ] `cargo test -q` exits 0 with no warnings in Gharargah-owned code.
- [ ] Fast Playwright renderer/electron suites exit 0.
- [ ] Native Tauri suite exits 0 with zero unexplained skips and zero retries.
- [ ] New tests pass three consecutive local runs.
- [ ] CI contains a required Tauri job and caches Cargo/pnpm artifacts.
- [ ] Production builds do not contain or enable WebDriver permissions/plugins.
- [ ] No sleeps are used as readiness synchronization; animation sampling may use frame-based waits with an explicit reason.

## STOP conditions

- STOP if the official embedded service cannot expose a capability required by a current semantic assertion; document the missing capability and keep the narrow custom adapter only for that operation.
- STOP if making tests pass requires product behavior changes; create a product finding instead.
- STOP if E2E capabilities appear in a normal release binary or production capability manifest.

