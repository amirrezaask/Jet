import type { AgentProviderKind } from "./types.js"

const LABELS: Record<AgentProviderKind, string> = {
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor",
  opencode: "OpenCode",
}

export function providerLabel(provider: AgentProviderKind): string {
  return LABELS[provider]
}

export function agentTabLabel(
  provider: AgentProviderKind,
  workspaceName: string,
  multiRoot: boolean,
  index?: number,
): string {
  const base = index != null && index > 0 ? `${providerLabel(provider)} ${index + 1}` : providerLabel(provider)
  return multiRoot ? `${base} · ${workspaceName}` : base
}
