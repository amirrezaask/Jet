import type { AgentRpcError } from "@gharargah/rpc"
import {
  AgentCommandError,
  ApprovalBlockedError,
  ThreadNotFoundError,
  TurnAlreadyRunningError,
} from "../effect/errors.js"
import { UnknownDriverError } from "../provider/registry.js"

function sanitizeMessage(message: string): string {
  return message
    .replace(/\/(?:Users|home|var|tmp|private|Volumes)(?:\/[^\s"'`,)]*)+/gi, "<path>")
    .replace(/\bat\s+[^\s]+\s+\([^)]+\)/g, "")
    .trim()
}

function taggedMessage(error: object): string {
  return sanitizeMessage(
    String(("message" in error && error.message) || ("_tag" in error && error._tag) || "error"),
  )
}

export function mapErrorToAgentRpc(error: unknown): AgentRpcError {
  if (error instanceof UnknownDriverError) {
    return {
      _tag: "UnknownDriverError",
      message: sanitizeMessage(error.message),
      retryable: false,
    }
  }
  if (error instanceof ThreadNotFoundError) {
    return {
      _tag: "ThreadNotFoundError",
      message: `thread not found`,
      detail: { threadId: error.threadId },
      retryable: false,
    }
  }
  if (error instanceof TurnAlreadyRunningError) {
    return {
      _tag: "TurnAlreadyRunningError",
      message: "turn_already_running",
      detail: { threadId: error.threadId },
      retryable: false,
    }
  }
  if (error instanceof ApprovalBlockedError) {
    return {
      _tag: "ApprovalBlockedError",
      message: `cannot ${error.operation} thread while approvals are open`,
      detail: { threadId: error.threadId, operation: error.operation },
      retryable: false,
    }
  }
  if (error instanceof AgentCommandError) {
    if (error.cause instanceof UnknownDriverError) {
      return mapErrorToAgentRpc(error.cause)
    }
    if (/catalog-only|CLI in terminal/i.test(error.message)) {
      return {
        _tag: "UnknownDriverError",
        message: sanitizeMessage(error.message),
        retryable: false,
      }
    }
    return {
      _tag: "AgentCommandError",
      message: sanitizeMessage(error.message),
      retryable: false,
    }
  }

  if (error && typeof error === "object" && "_tag" in error) {
    const tag = String((error as { _tag: string })._tag)
    switch (tag) {
      case "UnknownDriverError":
        return {
          _tag: "UnknownDriverError",
          message: taggedMessage(error as object),
          retryable: false,
        }
      case "ThreadNotFoundError":
        return {
          _tag: "ThreadNotFoundError",
          message: "thread not found",
          detail: { threadId: (error as { threadId?: string }).threadId },
          retryable: false,
        }
      case "TurnAlreadyRunningError":
        return {
          _tag: "TurnAlreadyRunningError",
          message: "turn_already_running",
          detail: { threadId: (error as { threadId?: string }).threadId },
          retryable: false,
        }
      case "ApprovalBlockedError": {
        const e = error as { operation?: string; threadId?: string }
        return {
          _tag: "ApprovalBlockedError",
          message: `cannot ${e.operation ?? "operate on"} thread while approvals are open`,
          detail: { threadId: e.threadId, operation: e.operation },
          retryable: false,
        }
      }
      case "AgentCommandError": {
        const message = taggedMessage(error as object)
        if (/catalog-only|CLI in terminal/i.test(message)) {
          return { _tag: "UnknownDriverError", message, retryable: false }
        }
        return {
          _tag: "AgentCommandError",
          message,
          retryable: false,
        }
      }
    }
  }

  if (error instanceof Error) {
    if (/catalog-only|CLI in terminal/i.test(error.message)) {
      return {
        _tag: "UnknownDriverError",
        message: sanitizeMessage(error.message),
        retryable: false,
      }
    }
    return {
      _tag: "AgentCommandError",
      message: sanitizeMessage(error.message || "agent rpc failed"),
      retryable: false,
    }
  }
  return {
    _tag: "AgentCommandError",
    message: "agent rpc failed",
    retryable: false,
  }
}
