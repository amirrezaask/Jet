import type { AgentThread, ProviderRuntimeEvent, SendAgentMessageInput } from "@gharargah/agents"
import type { AgentTransportKind } from "@gharargah/rpc"

export type ProviderAdapterContext = {
  thread: AgentThread
  turnId: string
  input: SendAgentMessageInput
  emit: (event: ProviderRuntimeEvent) => void
  signal: AbortSignal
  resolvePermission: (permissionId: string) => Promise<{
    optionId?: string
    decision?: string
    approvalDecision?: string
  }>
  resolveUserInput: (requestId: string) => Promise<unknown>
}

export type ProviderAdapter = {
  readonly id: string
  readonly kind: AgentTransportKind
  startTurn(ctx: ProviderAdapterContext): Promise<void>
  interrupt?(threadId: string): Promise<void>
  stopSession?(threadId: string): Promise<void>
}

export type ProviderInstance = {
  instanceId: string
  driverKind: string
  displayName: string
  homePath?: string | null
  env?: Record<string, string>
  enabled: boolean
  accentColor?: string
  continuationGroupKey: string
}
