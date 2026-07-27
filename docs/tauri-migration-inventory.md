# Tauri migration inventory (obsolete)

**Status (2026-07-28):** Complete. Tauri and the Rust `apps/server` host were removed.

Current architecture:

- Browser SPA → `createWebTransport()` → TypeScript `apps/host-server` (`POST /api/v1/rpc`, `/ws`)
- Agents → `apps/agent-server` on `:4751`
- Mocks → `apps/host-server/mocks/`

Do not reintroduce Rust or Tauri.
