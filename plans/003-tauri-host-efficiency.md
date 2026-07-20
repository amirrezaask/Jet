# Plan 003: Bound Tauri host CPU, memory, and resource lifetimes

> **Executor instructions**: Fix lifecycle and polling architecture before micro-optimizing loops. Add tests that reproduce each leak/race before changing it.
>
> **Drift check**: `git diff --stat a52fab2..HEAD -- apps/gharargah/src-tauri/src/host packages/jet-host-client/src/create-jet-api.ts tests/tauri`

## Status

- **Priority**: P0
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/001-tauri-verification.md`
- **Category**: bug / performance
- **Planned at**: commit `a52fab2`, 2026-07-11
- **Completed**: 2026-07-12 — watcher cancel/gen gates, LSP blocking idle timeouts, terminal deque bounds, lifecycle tests.

## Why this matters

Gharargah is a long-running editor. Current host code can accumulate workspace watchers, emit stale work after deactivation, wake each active LSP bridge every millisecond, and repeatedly scan/shift multi-megabyte terminal buffers. These costs directly affect battery, idle CPU, memory plateau, reload correctness, and the failing LSP/terminal E2E cases.

## Current state

- `host/workspace.rs:42-59,87-105`: reactivating a root increments a generation and overwrites `_watch_stop` without stopping the previous watcher/delayed thread.
- `host/workspace.rs:170-196`: `_gen` is unused, so stale background work can recreate indexes and emit branch/search-ready after deactivate or reactivation.
- `host/lsp.rs:314-373`: an active client uses nonblocking reads and `sleep(1ms)` when idle; pending WebSocket messages have no explicit byte/message bound.
- `host/lsp.rs:387-416`: the decoder repeatedly `drain`s from the front of a `Vec`, moving the remaining bytes.
- `host/terminal.rs:166-172,328-337`: every output chunk appends to a `String`, then front-drains it after 4 MiB.
- `packages/jet-host-client/src/create-jet-api.ts:46-52`: every buffered chunk recalculates total size with `reduce`, then uses front `shift`.
- Audit sample after opening TypeScript: Tauri shell 119 MiB RSS by `ps`, 1.5–1.7% idle CPU, 41 threads; LSP children add about 237 MiB RSS.

## Scope

**In scope**: workspace/search lifecycle, LSP bridge scheduling/bounds/framing, terminal replay buffers, host-client terminal buffering, lifecycle tests, CPU/memory benchmarks.

**Out of scope**: replacing language servers, changing terminal visible semantics, agent provider parity, visual motion.

## Steps

### 1. Make workspace activation idempotent and cancellable

Use an atomic cancellation token and explicit root lifecycle. Stop the previous watcher before replacement; check generation/cancellation before every branch/search-ready emit and before publishing/recreating an FFF index. Ensure deactivate prevents all later events and releases watcher/index state.

**Verify**: a Rust test activates the same root 20 times, deactivates it, and observes one watcher lifecycle, no post-deactivate events, and an empty host root/index registry.

### 2. Replace LSP busy polling with blocking readiness/timeouts

Use socket read/write timeouts, OS polling, or an async select loop so an idle connected LSP does not wake 1,000 times/second. Bound queued messages by count and bytes with a defined overflow policy that preserves protocol correctness. Keep reconnect semantics and process crash detection.

**Verify**: framing/reconnect tests pass; an idle LSP CPU benchmark remains near zero; a slow/disconnected client cannot grow memory without bound or deadlock the language server.

### 3. Make framing and replay buffers amortized O(1)

Give `LspDecoder` a read cursor and compact only occasionally. Replace Rust terminal replay front-drain with a bounded chunk deque/ring and join only for attach snapshots. Track buffered size incrementally in TypeScript and avoid `reduce`/`shift` per event. Preserve UTF-8 and sequence replay semantics.

**Verify**: tests cover split Unicode, >4 MiB output, many tiny chunks, attach/replay floors, and disposal. Add a benchmark for at least 100k small chunks with bounded peak memory.

### 4. Add long-session regression guards

Automate repeated workspace switch, LSP reload/reconnect, terminal create/dispose/replay, and app reload cycles. Measure threads, process RSS/private memory, child processes, and idle CPU after GC/settling. Set platform-aware budgets from a clean baseline.

**Verify**: after 50 cycles, resources return near baseline; no orphan language servers/shells/watchers remain; native E2E LSP reconnect and terminal persistence pass three runs.

## Done criteria

- [ ] `cargo test -q`, `pnpm -r typecheck`, and native Tauri E2E pass.
- [ ] No `sleep(Duration::from_millis(1))` polling loop remains in LSP.
- [ ] Workspace generation is checked at every async publish boundary.
- [ ] Terminal/LSP buffers have explicit, tested bounds and amortized O(1) append/consume.
- [ ] Before/after CPU, memory, thread, and throughput numbers are recorded.

## STOP conditions

- STOP if a buffer overflow policy could drop an LSP request/response silently; redesign the backpressure boundary.
- STOP if the portable PTY or FFF library cannot be cleanly cancelled; isolate and document the external lifecycle constraint before proceeding.
- STOP if a performance change alters terminal bytes, ordering, or LSP framing.

