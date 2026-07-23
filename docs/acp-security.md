# ACP security notes

## Filesystem containment

The ACP filesystem bridge accepts absolute paths only. `FsHandler` canonicalizes the workspace root and every target, verifies the resolved target is below that root, and rejects symlink escapes. Existing files are canonicalized directly; for a new file, its parent must already resolve inside the root. The current bridge exposes only text reads and writes.

The bridge does not support extra workspace roots. The generic path helper has a 32-root limit, but live ACP filesystem handling supplies one workspace root.

## Permissions

Production ACP permission requests are never auto-approved. A request is stored in the supervisor pending map and emitted to the renderer. The host resolver accepts a provider option through `agents:resolvePermission { requestId, optionId }`; the current renderer sends incompatible `{ permissionId, decision }` data, so the end-to-end resolver remains incomplete rather than falling back to approval. If the responder disappears, the ACP request is cancelled. `auto_permission_for_tests` is explicitly test-only.

Permission persistence is currently additive and limited: the raw permission payload is appended to `timeline` and `pendingPermissions`. The current resolve RPC forwards the result to ACP but does not yet remove the persisted pending entry or implement remembered allow rules.

## Secrets and diagnostics

`redaction.rs` redacts common credential keys (`authorization`, token, password, cookie, API-key variants) and inline Bearer/Basic/query-token strings. `ProtocolTrace` bounds entries to 1,024, redacts before storage, and truncates each serialized entry at 64 KiB.

Important limitation: that trace implementation is not yet wired into the live provider connection. The exposed `agents:getAcpTrace` inspector currently contains supervisor turn lifecycle metadata, not raw ACP messages. Do not assume host stderr, a provider CLI, or a mock run is secret-redacted.

## Bounds

Defined defensive limits are:

| Limit | Value | Live status |
|---|---:|---|
| Protocol message | 4 MiB | Constant exists; not enforced by the current connection transport. |
| Trace entries | 1,024 | Enforced by `ProtocolTrace` when used. |
| Trace entry | 64 KiB | Enforced by `ProtocolTrace` when used. |
| Timeline items per turn | 10,000 | Constant exists; live permission timeline append is not capped. |
| Text chunk | 256 KiB | Constant exists; live text stream is not capped. |
| Pending permissions | 128 | Constant exists; live pending map is not capped. |
| Allowed roots | 32 | Enforced by generic root canonicalization. |

## Unsaved editor buffers

The current ACP FS bridge reads and writes disk only; it has no connection to editor buffers. The intended policy, retained from the ACP audit, is:

- Read a dirty open buffer in preference to its disk copy.
- Write to disk, then mark a dirty open buffer conflicted/reload-needed.
- Never silently overwrite a dirty buffer.

That policy is not implemented; providers requiring buffer-aware edits should not be told that it is.

Terminal client methods and authentication flows are not advertised or implemented, so they have no host-side ACP policy yet.
