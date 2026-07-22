# Tauri migration inventory

This inventory records active integrations in the repository before the web-server migration. Generated Tauri schemas and lockfile entries are intentionally omitted from the call-site list.

## Runtime boundary

The renderer installs `window.gharargah` in `apps/gharargah/src/gharargah-adapter.ts`. It currently creates a `GharargahHostTransport` with dynamic imports from `@tauri-apps/api`, sends all request/response work through the `gharargah_host_invoke` Tauri command, and receives host events through Tauri `listen`.

The migration keeps the typed `GharargahHostAPI` used by React, replaces the transport with same-origin HTTP and one managed WebSocket, and moves the Rust channel implementations behind framework-independent server state. This avoids scattering `fetch` or `WebSocket` calls through components.

## Request/response mapping

| Existing channels | Current implementation | Server replacement |
| --- | --- | --- |
| `fs:readFile`, `fs:writeFile`, `fs:readDir`, `fs:stat` | `host/fs.rs` | HTTP RPC backed by the filesystem service; project/root validation is enforced server-side |
| `fs:showOpenFolderDialog`, `fs:showSaveFileDialog` | native Tauri dialogs in `shell.rs` | Browser-safe path input; compatibility calls return no native selection |
| `workspace:activate`, `workspace:deactivate` | `host/workspace.rs` | HTTP RPC; filesystem watch events use WebSocket |
| `search:listFiles`, `search:project`, `search:fileSearch`, `search:trackFileAccess`, `search:isScanReady`, `search:isSupported` | `host/search.rs` + FFF/ripgrep | HTTP RPC; indexing readiness uses WebSocket events |
| `git:isRepo`, `git:status`, `git:diff`, `git:branch`, `git:summary`, `git:branches`, `git:stage`, `git:unstage`, `git:discard`, `git:commit`, `git:checkout`, `git:fetch`, `git:pull`, `git:push`, `git:history` | `host/git.rs` | HTTP RPC backed by the Git service; process arguments remain individually escaped |
| `tasks:spawn` | `host/tasks.rs` | HTTP RPC backed by the task process service |
| `lsp:start`, `lsp:stop` | `host/lsp.rs` | HTTP lifecycle RPC; LSP transport and crash events use WebSocket |
| `terminal:create`, `terminal:attach`, `terminal:write`, `terminal:resize`, `terminal:dispose` | `host/terminal.rs` | HTTP lifecycle/control RPC; terminal output/exit uses WebSocket with bounded server replay and sequence numbers |
| `agents:listProviders`, `agents:refreshProviders`, `agents:listThreads`, `agents:readThread`, `agents:createThread`, `agents:sendMessage`, `agents:interruptTurn`, `agents:setArchived`, `agents:updateThreadSettings` | `host/agents.rs` | HTTP RPC; agent deltas and snapshots use WebSocket; processes remain server-owned |
| `gharargah:getLaunchConfig`, `gharargah:getHomeDir`, `gharargah:loadGlobalGharargahrcScanRoots` | Tauri shell state + `host/launch.rs` | HTTP RPC from server CLI/configuration state |
| `perf:recordStartup`, `perf:getStartupLogPath` | `host/perf.rs` | HTTP RPC |
| `shell:openInApp` | desktop opener | obsolete in a browser; compatibility response reports unsupported |
| `ui:syncNativeChrome` | native title-bar colors | obsolete no-op; browser owns chrome |

The compatibility RPC is versioned at `POST /api/v1/rpc`. Resource-oriented routes (`/api/v1/system`, `/api/v1/projects`, and filesystem routes) are added alongside it; the compatibility endpoint exists to preserve working product logic during the migration rather than expose Rust/Tauri internals.

## Realtime event mapping

| Existing event | Producer | WebSocket replacement |
| --- | --- | --- |
| `terminal:data`, `terminal:exit` | terminal PTY reader/waiter | `/ws`, sequenced event envelope; attach supplies bounded replay |
| `agents:threadUpdated`, `agents:threadDelta` | agent provider tasks | `/ws`, structured event envelope |
| `fs:changed` | workspace watcher | `/ws` |
| `workspace:fileIndex`, `workspace:searchReady` | workspace/search indexing | `/ws` |
| `lsp:crashed` | LSP process monitor | `/ws` |
| `gharargah:launch`, `gharargah:close-tab` | desktop lifecycle/native menu | obsolete; initial CLI target comes from `/api/v1/system`, browser close-tab remains a normal command |

## Desktop-only code to remove

- `apps/gharargah/src-tauri/tauri*.json`, capabilities, generated schemas, `build.rs`, Tauri crate/plugin dependencies, native menu/window code, single-instance and macOS open-file hooks.
- `packages/gharargah-host-client/src/tauri-transport.ts` and `@tauri-apps/api` dependencies.
- Tauri bootstrap HTML injection and `index.tauri.html` naming.
- `useTerminalFileDrop` dynamic Tauri webview import; browser drag/drop remains DOM-based.
- `data-tauri-drag-region` attributes and native chrome synchronization.
- WebDriver/Tauri Playwright launchers and native-only channel tests; browser tests launch the Rust server process.
- Tauri release/startup scripts and root commands.

## Framework-independent Rust modules retained

`fs`, `git`, `search`, `fff_service`, `tasks`, `uri`, launch resolution, terminal PTY ownership, agent provider logic, workspace watching, LSP process management, and performance logging contain reusable behavior. Their direct `tauri::AppHandle` dependency is only an event-delivery mechanism and is replaced by a bounded broadcast event hub.

## Obsolete behavior

Native open/save dialogs, native menus, tray/window lifecycle, title-bar color/traffic-light manipulation, single-instance activation, desktop file-open callbacks, updater/plugin hooks, and WebDriver capabilities have no browser/server equivalent and are removed rather than emulated.
