import { ProviderDriverKind } from "./t3contracts.js"

export const PROVIDER_OPTIONS: Array<{
  value: ReturnType<typeof ProviderDriverKind.make>
  label: string
  available: boolean
  pickerSidebarBadge?: "new" | "soon"
}> = [
  { value: ProviderDriverKind.make("codex"), label: "Codex", available: true },
  { value: ProviderDriverKind.make("claude"), label: "Claude", available: true },
  { value: ProviderDriverKind.make("claudeAgent"), label: "Claude", available: true },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("cursor-acp"),
    label: "Cursor (ACP)",
    available: true,
    pickerSidebarBadge: "new",
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    available: false,
    pickerSidebarBadge: "soon",
  },
]
