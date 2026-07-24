import { ProviderDriverKind } from "./t3contracts.js"

/** Product-facing provider catalog for icons/labels (not a transport stub). */
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
  // Legacy id still maps to Cursor branding (ACP is the default transport).
  {
    value: ProviderDriverKind.make("cursor-acp"),
    label: "Cursor",
    available: true,
  },
  {
    value: ProviderDriverKind.make("grok"),
    label: "Grok",
    available: true,
    pickerSidebarBadge: "new",
  },
]
