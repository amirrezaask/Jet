import type { AgentTransportKind } from "@gharargah/rpc"
import { Data } from "effect"
import type { ProviderAdapter } from "./types.js"
import { AcpProviderAdapter } from "./acp-adapter.js"
import { CodexAppServerAdapter } from "./codex-adapter.js"
import { ClaudeSdkAdapter } from "./claude-adapter.js"
import { OpenCodeAdapter } from "./opencode-adapter.js"
import type { ProviderInstance } from "./types.js"

export class UnknownDriverError extends Data.TaggedError("UnknownDriverError")<{
  readonly driverId: string
  readonly message: string
}> {}

export function createAdapter(driverId: string): ProviderAdapter {
  if (driverId === "codex:app-server") return new CodexAppServerAdapter()
  if (driverId === "claude:sdk") return new ClaudeSdkAdapter()
  if (driverId === "opencode:sdk") return new OpenCodeAdapter()
  if (driverId === "opencode:acp") return new AcpProviderAdapter("opencode:acp")
  if (driverId.endsWith(":acp")) return new AcpProviderAdapter(driverId)
  if (driverId.endsWith(":cli")) {
    throw new UnknownDriverError({
      driverId,
      message: `Driver ${driverId} is catalog-only (CLI in terminal). Use the primary transport: *:acp, *:sdk, or *:app-server.`,
    })
  }
  throw new UnknownDriverError({
    driverId,
    message: `Unknown agent driver: ${driverId}`,
  })
}

export function defaultProviderInstances(): ProviderInstance[] {
  const claudeHome = process.env.GHARARGAH_CLAUDE_HOME ?? null
  return [
    {
      instanceId: "codex",
      driverKind: "codex",
      displayName: "Codex",
      enabled: true,
      continuationGroupKey: "codex:default",
    },
    {
      instanceId: claudeHome ? `claude:home:${claudeHome}` : "claude",
      driverKind: "claude",
      displayName: "Claude",
      enabled: true,
      homePath: claudeHome,
      continuationGroupKey: `claude:home:${claudeHome ?? "default"}`,
      env: claudeHome ? { HOME: claudeHome } : undefined,
    },
    {
      instanceId: "opencode",
      driverKind: "opencode",
      displayName: "OpenCode",
      enabled: true,
      continuationGroupKey: "opencode:default",
    },
    {
      instanceId: "cursor",
      driverKind: "cursor",
      displayName: "Cursor",
      enabled: true,
      continuationGroupKey: "cursor:default",
    },
    {
      instanceId: "grok",
      driverKind: "grok",
      displayName: "Grok",
      enabled: true,
      continuationGroupKey: "grok:default",
    },
  ]
}

export type { ProviderAdapter, ProviderInstance, ProviderAdapterContext } from "./types.js"
export type { AgentTransportKind }
