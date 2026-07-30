import { Data } from "effect"

/** Host / shared wire error codes (stable JSON). */
export type HostErrorCode =
  | "PATH_OUTSIDE_ALLOWED_ROOTS"
  | "UNKNOWN_OPERATION"
  | "OPERATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "HOST_DISCONNECTED"

export class PathOutsideRootsError extends Data.TaggedError("PathOutsideRoots")<{
  readonly message: string
  readonly path?: string
}> {
  readonly code = "PATH_OUTSIDE_ALLOWED_ROOTS" as const
}

export class UnknownChannelError extends Data.TaggedError("UnknownChannel")<{
  readonly channel: string
  readonly message: string
}> {
  readonly code = "UNKNOWN_OPERATION" as const
}

export function unknownChannel(channel: string): UnknownChannelError {
  return new UnknownChannelError({
    channel,
    message: `unknown host channel: ${channel}`,
  })
}

export class OperationFailedError extends Data.TaggedError("OperationFailed")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly code = "OPERATION_FAILED" as const
}

export class NotFoundError extends Data.TaggedError("NotFound")<{
  readonly message: string
  readonly resource?: string
}> {
  readonly code = "NOT_FOUND" as const
}

export class ConflictError extends Data.TaggedError("Conflict")<{
  readonly message: string
}> {
  readonly code = "CONFLICT" as const
}

export class PayloadTooLargeError extends Data.TaggedError("PayloadTooLarge")<{
  readonly message: string
}> {
  readonly code = "PAYLOAD_TOO_LARGE" as const
}

export class LspCrashedError extends Data.TaggedError("LspCrashed")<{
  readonly sessionId: string
  readonly message: string
}> {
  readonly code = "OPERATION_FAILED" as const
}

export class AgentRpcError extends Data.TaggedError("AgentRpcError")<{
  readonly message: string
  readonly method?: string
  readonly cause?: unknown
}> {}

export class InvalidRpcPayloadError extends Data.TaggedError("InvalidRpcPayload")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly code = "OPERATION_FAILED" as const
}

/** Transport closed or WS dropped while an invoke was in flight. */
export class HostDisconnectedError extends Data.TaggedError("HostDisconnected")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly code = "HOST_DISCONNECTED" as const
}

/** Git CLI failed (non-zero exit / spawn error). Wire code stays OPERATION_FAILED. */
export class GitCommandFailedError extends Data.TaggedError("GitCommandFailed")<{
  readonly message: string
  readonly cause?: unknown
}> {
  readonly code = "OPERATION_FAILED" as const
}

export type HostRpcError =
  | PathOutsideRootsError
  | UnknownChannelError
  | OperationFailedError
  | NotFoundError
  | ConflictError
  | PayloadTooLargeError
  | LspCrashedError
  | InvalidRpcPayloadError
  | HostDisconnectedError
  | GitCommandFailedError

export function hostErrorHttpStatus(error: HostRpcError): number {
  switch (error._tag) {
    case "PathOutsideRoots":
      return 403
    case "NotFound":
      return 404
    case "Conflict":
      return 409
    case "PayloadTooLarge":
      return 413
    case "HostDisconnected":
      return 503
    default:
      return 400
  }
}

export function hostErrorWire(error: HostRpcError): {
  code: HostErrorCode
  message: string
  details: Record<string, unknown>
} {
  return {
    code: error.code,
    message: error.message,
    details: {},
  }
}
