import { Data } from "effect"

export class AgentCommandError extends Data.TaggedError("AgentCommandError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class ThreadNotFoundError extends Data.TaggedError("ThreadNotFoundError")<{
  readonly threadId: string
}> {}

export class TurnAlreadyRunningError extends Data.TaggedError("TurnAlreadyRunningError")<{
  readonly threadId: string
}> {}

export class ApprovalBlockedError extends Data.TaggedError("ApprovalBlockedError")<{
  readonly operation: string
  readonly threadId: string
}> {}

export type OrchError =
  | AgentCommandError
  | ThreadNotFoundError
  | TurnAlreadyRunningError
  | ApprovalBlockedError
