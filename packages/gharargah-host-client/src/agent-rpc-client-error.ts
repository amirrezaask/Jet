import type { AgentRpcError } from "@gharargah/rpc"
import { normalizeAgentRpcError } from "@gharargah/rpc"

/** Typed client-side error for failed agent-server RPC invocations. */
export class AgentRpcClientError extends Error {
  readonly tag: string
  readonly detail?: unknown
  readonly retryable: boolean

  constructor(payload: AgentRpcError) {
    super(payload.message)
    this.name = "AgentRpcClientError"
    this.tag = payload._tag
    this.detail = payload.detail
    this.retryable = payload.retryable ?? false
  }
}

export function agentRpcClientErrorFromWire(
  error: string | AgentRpcError,
): AgentRpcClientError {
  return new AgentRpcClientError(normalizeAgentRpcError(error))
}
