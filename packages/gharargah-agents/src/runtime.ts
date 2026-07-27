/** Provider runtime events — adapters emit these; orchestration owns product semantics. */

export type ProviderRuntimeEvent =
  | { type: "turn.started"; turnId: string; threadId: string }
  | { type: "content.delta"; turnId: string; threadId: string; text: string; messageId: string }
  | {
      type: "content.done"
      turnId: string
      threadId: string
      messageId: string
      text: string
    }
  | {
      type: "tool.upsert"
      turnId: string
      threadId: string
      toolCallId: string
      name: string
      status: "pending" | "running" | "completed" | "failed" | "cancelled"
      summary?: string
      input?: string
      output?: string
      error?: string
    }
  | {
      type: "request.permission"
      turnId: string
      threadId: string
      request: import("./types.js").AgentPermissionRequest
    }
  | {
      type: "request.userInput"
      turnId: string
      threadId: string
      request: import("./types.js").AgentUserInputRequest
    }
  | {
      type: "commands.update"
      threadId: string
      commands: ReadonlyArray<import("./types.js").AgentAvailableCommand>
    }
  | {
      type: "thought.delta"
      turnId: string
      threadId: string
      text: string
      thoughtId?: string
    }
  | {
      type: "plan.update"
      turnId: string
      threadId: string
      plan: import("./types.js").AgentPlan
    }
  | {
      type: "usage.update"
      turnId: string
      threadId: string
      usage: import("./types.js").AgentUsage
    }
  | {
      type: "connection.update"
      threadId: string
      connection: import("./types.js").AgentConnectionState
    }
  | {
      type: "session.bound"
      threadId: string
      acpSessionId?: string
      providerSessionId?: string
      providerTransport?: string
      providerInstanceId?: string
      sessionModes?: import("./types.js").AgentThread["sessionModes"]
      configOptions?: import("./types.js").AgentThread["configOptions"]
      discoveredModels?: import("./types.js").ProviderModel[] | null
      model?: string | null
    }
  | { type: "turn.completed"; turnId: string; threadId: string }
  | { type: "turn.cancelled"; turnId: string; threadId: string }
  | { type: "turn.failed"; turnId: string; threadId: string; error: string }

export type OrchestrationCommand =
  | { type: "thread.create"; commandId: string; input: import("./types.js").CreateAgentThreadInput }
  | { type: "thread.turn.start"; commandId: string; input: import("./types.js").SendAgentMessageInput }
  | {
      type: "thread.turn.interrupt"
      commandId: string
      input: import("./types.js").InterruptAgentTurnInput
    }
  | {
      type: "thread.approval.respond"
      commandId: string
      input: import("./types.js").ResolveAgentPermissionInput
    }
  | {
      type: "thread.userInput.respond"
      commandId: string
      input: import("./types.js").ResolveAgentUserInputInput
    }
  | {
      type: "thread.archive"
      commandId: string
      input: import("./types.js").SetAgentThreadArchivedInput
    }
  | {
      type: "thread.settings.update"
      commandId: string
      input: import("./types.js").UpdateAgentThreadSettingsInput
    }
  | {
      type: "thread.settle"
      commandId: string
      workspaceRootPath: string
      threadId: string
    }
  | {
      type: "thread.snooze"
      commandId: string
      workspaceRootPath: string
      threadId: string
    }
  | {
      type: "thread.checkpoint.create"
      commandId: string
      input: {
        workspaceRootUri?: string
        workspaceRootPath: string
        threadId: string
        label?: string
        turnId?: string
      }
    }
  | {
      type: "thread.checkpoint.revert"
      commandId: string
      input: {
        workspaceRootUri?: string
        workspaceRootPath: string
        threadId: string
        checkpointId: string
      }
    }

export const MAX_BUFFERED_ASSISTANT_CHARS = 24_000
export const PROVIDER_SEND_TURN_MAX_CHARS = 120_000
export const PROVIDER_SEND_TURN_MAX_ATTACHMENTS = 8
