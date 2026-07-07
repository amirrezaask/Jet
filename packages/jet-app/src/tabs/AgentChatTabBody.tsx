import type { AgentThread } from "@jet/agents"
import { isDarkTheme } from "@jet/codemirror"
import { AgentChatView } from "@jet/ui"
import { useEffect, useRef, useState } from "react"
import type { TabContributorDeps } from "./deps.js"

export function AgentChatTabBody(props: {
  rootUri: string
  threadId: string
  deps: TabContributorDeps
}) {
  const { rootUri, threadId, deps } = props
  const [thread, setThread] = useState<AgentThread | null>(() =>
    deps.getAgentThread(rootUri, threadId),
  )
  const settingsTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setThread(deps.getAgentThread(rootUri, threadId))
    return deps.subscribeAgentThread(rootUri, threadId, setThread)
  }, [rootUri, threadId, deps])

  useEffect(
    () => () => {
      if (settingsTimerRef.current != null) {
        window.clearTimeout(settingsTimerRef.current)
      }
    },
    [],
  )

  const handleSelectionChange = (instanceId: string, model: string) => {
    if (settingsTimerRef.current != null) {
      window.clearTimeout(settingsTimerRef.current)
    }
    settingsTimerRef.current = window.setTimeout(() => {
      void deps.updateAgentThreadSettings(rootUri, threadId, {
        provider: instanceId,
        model,
      })
    }, 250)
  }

  return (
    <AgentChatView
      thread={thread}
      providers={deps.getAgentProviders()}
      theme={isDarkTheme(deps.getTheme()) ? "dark" : "light"}
      onSend={payload => deps.sendAgentMessage(rootUri, threadId, payload)}
      onInterrupt={() => deps.interruptAgentTurn(rootUri, threadId)}
      onSelectionChange={handleSelectionChange}
      onProvidersRefresh={() => void deps.refreshAgentProviders()}
    />
  )
}
