export type LspStatus =
  | "idle"
  | "starting"
  | "ready"
  | "unavailable"
  | "disconnected"
  | "restarting"
  | "failed"

export function lspStatusLabel(status: LspStatus): string {
  switch (status) {
    case "ready":
      return "LSP on"
    case "starting":
      return "LSP starting"
    case "restarting":
      return "LSP restarting"
    case "unavailable":
      return "LSP unavailable"
    case "failed":
      return "LSP failed"
    case "disconnected":
      return "LSP disconnected"
    default:
      return "LSP off"
  }
}

export function lspStatusShortLabel(status: LspStatus): string {
  switch (status) {
    case "ready":
      return "on"
    case "starting":
      return "…"
    case "restarting":
      return "retry"
    case "unavailable":
      return "n/a"
    case "failed":
      return "err"
    case "disconnected":
      return "off"
    default:
      return "off"
  }
}

export function lspStatusIsActive(status: LspStatus): boolean {
  return status === "ready" || status === "starting" || status === "restarting"
}
