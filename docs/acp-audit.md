# ACP Audit — Gharargah / Jet (ARCHIVED)

> **Stale as of 2026-07-23.** This document describes the retired one-shot `acp_client.rs` path (per-turn process, auto-approve permissions, no FS/terminal).
>
> **Authoritative sources now:**
>
> - [`acp-architecture.md`](./acp-architecture.md) — live `ConnectionPool` + `SessionRuntime` + `AcpSupervisor`
> - [`acp-support-matrix.md`](./acp-support-matrix.md) — capability truth table + t3code parity checklist
> - [`acp-provider-compatibility.md`](./acp-provider-compatibility.md) — provider profiles + opt-in smokes
>
> Keep this file only as historical context for why the supervisor migration happened. Do not use it for implementation decisions.

---

## Historical snapshot (2026-07-23)

Date: 2026-07-23  
Scope: Agent Client Protocol (stable v1) integration in `apps/server` + agent UI packages  
Pinned SDK at audit: `agent-client-protocol = "1.2"` (resolved 1.2.0; crates.io latest SDK 1.3.0; protocol version remains stable `1`)

The body below is frozen history. Gaps listed here (auto-approve, no FS, nested Tokio, one process per turn) were addressed by the `host/acp/` ConnectionPool rewrite — see the matrix.
