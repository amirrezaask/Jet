import { Schema } from "effect"

/** Agent-server WS JSON-RPC request. */
export const AgentRpcRequest = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
})
export type AgentRpcRequest = Schema.Schema.Type<typeof AgentRpcRequest>

export const AgentRpcSuccess = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  result: Schema.Unknown,
})
export type AgentRpcSuccess = Schema.Schema.Type<typeof AgentRpcSuccess>

export const AgentRpcFailure = Schema.Struct({
  id: Schema.optional(Schema.Union(Schema.String, Schema.Number)),
  error: Schema.String,
})
export type AgentRpcFailure = Schema.Schema.Type<typeof AgentRpcFailure>

export const AgentRpcResponse = Schema.Union(AgentRpcSuccess, AgentRpcFailure)
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

export const WorkspaceParams = Schema.Struct({
  workspaceRootUri: Schema.optional(Schema.String),
  workspaceRootPath: Schema.optional(Schema.String),
})

export const ThreadIdParams = Schema.Struct({
  threadId: Schema.String,
  workspaceRootPath: Schema.optional(Schema.String),
  workspaceRootUri: Schema.optional(Schema.String),
})

export const decodeAgentRpcRequest = Schema.decodeUnknown(AgentRpcRequest)
export const encodeAgentRpcSuccess = Schema.encode(AgentRpcSuccess)
export const encodeAgentPushEvent = Schema.encode(AgentPushEvent)
