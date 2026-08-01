import type { AgentProvider } from "./notifications.js"

export type AgentCliHistoryProvider = Exclude<
  AgentProvider,
  "shell" | "system"
>

export type AgentCliHistorySession = {
  /** Provider-native session/thread id used by the CLI resume command. */
  id: string
  provider: AgentCliHistoryProvider
  title: string
  /** Absolute provider-recorded working directory when the CLI exposes it. */
  cwd: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type AgentCliHistoryResult =
  | {
      provider: AgentCliHistoryProvider
      state: "ready"
      sessions: AgentCliHistorySession[]
    }
  | {
      provider: AgentCliHistoryProvider
      state: "unsupported" | "unavailable"
      message: string
      sessions: []
    }
