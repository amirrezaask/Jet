import { Effect, Schema } from "effect"

/** Unified transport vocabulary for catalog entries and provider adapters. */
export const AgentTransportKind = Schema.Literal(
  "cli",
  "acp",
  "app-server",
  "sdk",
  "mock",
)
export type AgentTransportKind = Schema.Schema.Type<typeof AgentTransportKind>

/** Map a driver id (e.g. `codex:app-server`) to its transport kind. */
export function agentTransportKindForDriverId(driverId: string): AgentTransportKind {
  if (driverId.endsWith(":cli")) return "cli"
  if (driverId.endsWith(":acp")) return "acp"
  if (driverId.endsWith(":app-server")) return "app-server"
  if (driverId.endsWith(":sdk")) return "sdk"
  if (driverId.endsWith(":mock")) return "mock"
  return "app-server"
}

/** Agent-server WS JSON-RPC request. */
export const AgentRpcRequest = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
})
export type AgentRpcRequest = Schema.Schema.Type<typeof AgentRpcRequest>

/** Typed error payload on the agent WS wire (stable `_tag` values). */
export const AgentRpcError = Schema.Struct({
  _tag: Schema.String,
  message: Schema.String,
  detail: Schema.optional(Schema.Unknown),
  retryable: Schema.optional(Schema.Boolean),
})
export type AgentRpcError = Schema.Schema.Type<typeof AgentRpcError>

export const AgentRpcSuccess = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  result: Schema.Unknown,
})
export type AgentRpcSuccess = Schema.Schema.Type<typeof AgentRpcSuccess>

/** Legacy servers sent `error: string`; new servers send `error: AgentRpcError`. */
export const AgentRpcFailure = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  error: Schema.Union(Schema.String, AgentRpcError),
})
export type AgentRpcFailure = Schema.Schema.Type<typeof AgentRpcFailure>

export const AgentRpcResponse = Schema.Union(AgentRpcFailure, AgentRpcSuccess)
export type AgentRpcResponse = Schema.Schema.Type<typeof AgentRpcResponse>

export const AgentPushEvent = Schema.Struct({
  event: Schema.String,
  payload: Schema.Unknown,
})
export type AgentPushEvent = Schema.Schema.Type<typeof AgentPushEvent>

export const AGENT_RPC_METHODS = [
  "agents:listThreads",
  "agents:readThread",
  "agents:createThread",
  "agents:sendMessage",
  "agents:interruptTurn",
  "agents:resolvePermission",
  "agents:resolveUserInput",
  "agents:setArchived",
  "agents:updateThreadSettings",
  "agents:createCheckpoint",
  "agents:revertCheckpoint",
  "agents:listAgents",
  "agents:refreshAgents",
  "agents:listProviders",
  "agents:refreshProviders",
  "agents:getConnectionState",
  "agents:getAcpTrace",
  "agents:authenticate",
  "agents:setSessionConfigOption",
  "agents:forceStopProvider",
  "agents:listAcpSessions",
  "agents:closeAcpSession",
  "agents:deleteAcpSession",
  "agents:logoutProvider",
] as const
export type AgentRpcMethod = (typeof AGENT_RPC_METHODS)[number]

export const AGENT_PUSH_EVENTS = [
  "agents:threadUpdated",
  "agents:threadDelta",
  "agents:structuredDelta",
  "agents:permissionRequest",
  "agents:shellEnvReady",
] as const
export type AgentPushEventName = (typeof AGENT_PUSH_EVENTS)[number]

/** Minimal structural validation for push payloads before client dispatch. */
export const AgentThreadUpdatedPayload = Schema.Struct({
  id: Schema.String,
  workspaceRootUri: Schema.String,
  workspaceRootPath: Schema.String,
  title: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  messages: Schema.optional(Schema.Array(Schema.Unknown)),
})
export type AgentThreadUpdatedPayload = Schema.Schema.Type<typeof AgentThreadUpdatedPayload>

export const AgentThreadDeltaPayload = Schema.Struct({
  workspaceRootUri: Schema.String,
  threadId: Schema.String,
  updatedAt: Schema.String,
  status: Schema.String,
  lastError: Schema.NullOr(Schema.String),
  messageId: Schema.String,
  text: Schema.String,
  streaming: Schema.Boolean,
})
export type AgentThreadDeltaPayload = Schema.Schema.Type<typeof AgentThreadDeltaPayload>

export const AgentStructuredDeltaPayload = Schema.Struct({
  workspaceRootUri: Schema.String,
  threadId: Schema.String,
  sequence: Schema.Number,
  updatedAt: Schema.String,
})
export type AgentStructuredDeltaPayload = Schema.Schema.Type<typeof AgentStructuredDeltaPayload>

export const AgentPermissionRequestPayload = Schema.Struct({
  workspaceRootUri: Schema.String,
  workspaceRootPath: Schema.optional(Schema.String),
  threadId: Schema.String,
  request: Schema.Struct({
    id: Schema.String,
    title: Schema.optional(Schema.String),
    options: Schema.optional(Schema.Array(Schema.Unknown)),
    createdAt: Schema.optional(Schema.String),
    status: Schema.optional(Schema.String),
  }),
})
export type AgentPermissionRequestPayload = Schema.Schema.Type<
  typeof AgentPermissionRequestPayload
>

export const AgentShellEnvReadyPayload = Schema.Union(
  Schema.Null,
  Schema.Struct({
    status: Schema.optional(Schema.String),
  }),
)

export const WorkspaceParams = Schema.Struct({
  workspaceRootUri: Schema.optional(Schema.String),
  workspaceRootPath: Schema.optional(Schema.String),
})

export const ThreadIdParams = Schema.Struct({
  threadId: Schema.String,
  workspaceRootPath: Schema.optional(Schema.String),
  workspaceRootUri: Schema.optional(Schema.String),
})

/** Normalize legacy string errors and structured errors from the wire. */
export function normalizeAgentRpcError(
  error: string | AgentRpcError,
): AgentRpcError {
  if (typeof error === "string") {
    return { _tag: "LegacyAgentRpcError", message: error, retryable: false }
  }
  return error
}

export function decodeAgentPushPayload(
  event: AgentPushEventName,
  payload: unknown,
): Effect.Effect<unknown, unknown> {
  switch (event) {
    case "agents:threadUpdated":
      return Schema.decodeUnknown(AgentThreadUpdatedPayload)(payload)
    case "agents:threadDelta":
      return Schema.decodeUnknown(AgentThreadDeltaPayload)(payload)
    case "agents:structuredDelta":
      return Schema.decodeUnknown(AgentStructuredDeltaPayload)(payload)
    case "agents:permissionRequest":
      return Schema.decodeUnknown(AgentPermissionRequestPayload)(payload)
    case "agents:shellEnvReady":
      return Schema.decodeUnknown(AgentShellEnvReadyPayload)(payload)
    default:
      return Effect.fail(new Error(`unknown push event: ${event}`))
  }
}

export const decodeAgentRpcRequest = Schema.decodeUnknown(AgentRpcRequest)
export const decodeAgentRpcResponse = Schema.decodeUnknown(AgentRpcResponse)
export const encodeAgentRpcSuccess = Schema.encode(AgentRpcSuccess)
export const encodeAgentRpcFailure = Schema.encode(AgentRpcFailure)
export const encodeAgentPushEvent = Schema.encode(AgentPushEvent)
